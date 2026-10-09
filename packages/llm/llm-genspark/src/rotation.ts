/**
 * Round-robin API-key rotation for the Genspark LLM proxy.
 *
 * The rotation owns exactly one fact: which slot (1..100) is currently in use.
 * The slot pointer is persisted, so a restart keeps using the key that was in
 * use rather than starting over at slot 1 and re-spending a request on every
 * key that is already exhausted.
 *
 * Exhaustion is decided from the HTTP response head, before the body is read:
 * the Genspark proxy answers a spent key with HTTP 200 and an
 * `x-genspark-credit-wall` header (body: a plain assistant message telling the
 * user to buy credits), so a status-code check alone would accept the credit
 * notice as the model's real answer. Because the decision happens before any
 * byte of the body reaches pi-ai, the same request is re-sent with the next
 * key and the conversation never sees the failed attempt — the agent's memory
 * (the durable session log) is untouched by a key change.
 *
 * @module @deepseek-ai/dsh-llm-genspark/rotation
 */

/** Maximum number of API-key slots. */
export const MAX_KEY_SLOTS = 100

/** Response header the Genspark proxy sets when the key cannot pay for the request. */
export const CREDIT_WALL_HEADER = 'x-genspark-credit-wall'

/** Why one key was rotated away from. */
export type ExhaustionReason =
  | { readonly kind: 'credit-wall'; readonly code: string }
  | { readonly kind: 'http'; readonly status: number }

/** One observable rotation step, for logs and the settings page. */
export interface RotationEvent {
  /** Slot that was abandoned (1-based). */
  readonly from: number
  /** Slot now in use (1-based). */
  readonly to: number
  /** Why `from` was abandoned. */
  readonly reason: ExhaustionReason
  /** Whether the walk wrapped from the last configured slot back to the first. */
  readonly wrapped: boolean
}

/** Persistence for the current slot pointer. */
export interface RotationStateStore {
  /** @returns the last persisted 1-based slot, or undefined when none is stored. */
  load(): number | undefined
  /** @param slot - the 1-based slot to persist. */
  save(slot: number): void
}

/**
 * In-memory store, used by tests and compositions without a writable home.
 * @param initial - starting slot.
 * @returns the store.
 */
export function memoryRotationStore(initial?: number): RotationStateStore {
  let slot = initial
  return {
    load: () => slot,
    save: (next) => { slot = next },
  }
}

/** One configured key slot. */
export interface KeySlot {
  /** 1-based slot number (stable: removing slot 3 does not renumber slot 4). */
  readonly slot: number
  /** The key literal. */
  readonly key: string
}

/**
 * Decide whether one response head means "this key is spent; use the next one".
 *
 * HTTP 401/403 (invalid / revoked key) and 402 (payment required) rotate, as
 * does a credit-wall header on any status. 429 is deliberately NOT treated as
 * exhaustion: it is a transient rate limit the retry policy already backs off
 * from, and rotating on it would walk all 100 keys during one burst.
 * @param response - the provider response head.
 * @returns the reason to rotate, or undefined to accept the response.
 */
export function exhaustionOf(response: Pick<Response, 'status' | 'headers'>): ExhaustionReason | undefined {
  const wall = response.headers.get(CREDIT_WALL_HEADER)
  if (wall !== null && wall.length > 0) return { kind: 'credit-wall', code: wall }
  if (response.status === 401 || response.status === 402 || response.status === 403) {
    return { kind: 'http', status: response.status }
  }
  return undefined
}

/**
 * Render a reason for logs without any credential material.
 * @param reason - the exhaustion reason.
 * @returns human-readable text.
 */
export function describeExhaustion(reason: ExhaustionReason): string {
  return reason.kind === 'credit-wall'
    ? `credit wall (${reason.code})`
    : `HTTP ${reason.status}`
}

/**
 * The rotation state machine. Keys are supplied per call so a key added or
 * removed in settings takes effect on the next request without a restart.
 */
export class KeyRotation {
  private current: number | undefined
  private readonly store: RotationStateStore
  private readonly onRotate: ((event: RotationEvent) => void) | undefined

  constructor(store: RotationStateStore = memoryRotationStore(), onRotate?: (event: RotationEvent) => void) {
    this.store = store
    this.onRotate = onRotate
    this.current = store.load()
  }

  /**
   * The slot to use now among the configured ones. A persisted slot that no
   * longer holds a key advances to the next configured slot (wrapping).
   * @param slots - configured slots in ascending slot order.
   * @returns the slot in use, or undefined when no key is configured.
   */
  active(slots: readonly KeySlot[]): KeySlot | undefined {
    const first = slots[0]
    if (first === undefined) return undefined
    const pointer = this.current ?? first.slot
    const exact = slots.find(slot => slot.slot === pointer)
    if (exact !== undefined) return exact
    const next = slots.find(slot => slot.slot > pointer) ?? first
    this.set(next.slot)
    return next
  }

  /** @returns the 1-based slot pointer currently persisted (may name an empty slot). */
  pointer(): number | undefined {
    return this.current
  }

  /**
   * Abandon `from` and move to the next configured slot; after the last
   * configured slot the walk returns to the first. A concurrent request that
   * already moved the pointer past `from` is honoured instead of advancing
   * twice.
   * @param slots - configured slots in ascending slot order.
   * @param from - the slot the failing request used.
   * @param reason - why it failed.
   * @returns the slot to use next.
   */
  advance(slots: readonly KeySlot[], from: number, reason: ExhaustionReason): KeySlot | undefined {
    const first = slots[0]
    if (first === undefined) return undefined
    if (this.current !== undefined && this.current !== from) {
      const moved = slots.find(slot => slot.slot === this.current)
      if (moved !== undefined) return moved
    }
    const later = slots.find(slot => slot.slot > from)
    const next = later ?? first
    this.set(next.slot)
    this.onRotate?.({ from, to: next.slot, reason, wrapped: later === undefined })
    return next
  }

  /**
   * Point at one slot explicitly (the settings page's "use this key now").
   * @param slot - 1-based slot.
   */
  select(slot: number): void {
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_KEY_SLOTS) {
      throw new RangeError(`key slot must be an integer in 1..${MAX_KEY_SLOTS}`)
    }
    this.set(slot)
  }

  private set(slot: number): void {
    if (this.current === slot) return
    this.current = slot
    this.store.save(slot)
  }
}

/** What one rotating fetch call needs from its owner. */
export interface RotatingFetchOptions {
  /** Configured slots, read per request so settings edits apply immediately. */
  slots: () => Promise<readonly KeySlot[]>
  /** The shared rotation. */
  rotation: KeyRotation
  /** Underlying fetch. */
  fetch?: typeof globalThis.fetch
  /**
   * Upper bound of keys tried for one request; defaults to every configured
   * key once, so a request fails only after a full lap found no usable key.
   */
  maxAttempts?: number
}

/** Thrown when a full lap over every configured key found none usable. */
export class AllKeysExhaustedError extends Error {
  readonly tried: number
  readonly lastReason: ExhaustionReason | undefined

  constructor(tried: number, lastReason: ExhaustionReason | undefined) {
    super(
      `genspark: all ${tried} configured API key(s) were rejected`
      + (lastReason === undefined ? '' : ` (last: ${describeExhaustion(lastReason)})`)
      + '; add credits or keys on the Genspark settings page — the next request starts again from the current key',
    )
    this.name = 'AllKeysExhaustedError'
    this.tried = tried
    this.lastReason = lastReason
  }
}

/** Thrown when no key slot holds a key. */
export class NoKeysConfiguredError extends Error {
  constructor() {
    super('genspark: no API key is configured; add at least one key on the Genspark settings page (Plugins → Genspark)')
    this.name = 'NoKeysConfiguredError'
  }
}

function withAuthorization(init: RequestInit | undefined, key: string): RequestInit {
  const headers = new Headers(init?.headers)
  headers.set('authorization', `Bearer ${key}`)
  // The Anthropic-protocol client authenticates with x-api-key instead.
  if (headers.has('x-api-key')) headers.set('x-api-key', key)
  return { ...init, headers }
}

/**
 * A fetch that authenticates each request with the active key and, when the
 * response head says that key is spent, re-sends the identical request with
 * the next key — repeating until a key is accepted or every key was tried.
 * Only the request body bytes are replayed; nothing of the rejected response
 * is surfaced, so the model sees one uninterrupted request.
 * @param options - slots, rotation, and the underlying fetch.
 * @returns a fetch-compatible function.
 */
export function rotatingFetch(options: RotatingFetchOptions): typeof globalThis.fetch {
  const base = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  return async (input, init) => {
    const slots = await options.slots()
    let slot = options.rotation.active(slots)
    if (slot === undefined) throw new NoKeysConfiguredError()
    // A streamed body can only be read once; materialize it so a retry with
    // the next key sends the same bytes. Provider SDK bodies are strings.
    const request = input instanceof Request ? input : undefined
    let body = init?.body
    if (body === undefined && request !== undefined && request.body !== null) {
      body = await request.clone().arrayBuffer()
    }
    const target = request?.url ?? input
    const baseInit: RequestInit = {
      ...request === undefined ? {} : { method: request.method, headers: request.headers, signal: request.signal },
      ...init,
      ...body === undefined || body === null ? {} : { body },
    }
    const limit = Math.max(1, Math.min(options.maxAttempts ?? slots.length, MAX_KEY_SLOTS))
    let lastReason: ExhaustionReason | undefined
    for (let attempt = 0; attempt < limit; attempt++) {
      const response = await base(target as Parameters<typeof base>[0], withAuthorization(baseInit, slot.key))
      const reason = exhaustionOf(response)
      if (reason === undefined) return response
      lastReason = reason
      // Release the rejected body (the credit notice) without reading it.
      await response.body?.cancel().catch(() => {})
      const next = options.rotation.advance(slots, slot.slot, reason)
      /* v8 ignore next -- advance only returns undefined for an empty slot list, excluded above. */
      if (next === undefined) break
      slot = next
    }
    throw new AllKeysExhaustedError(limit, lastReason)
  }
}
