/**
 * Host service behind `ctx.remote.genspark`: key-slot status, explicit slot
 * selection, bulk key entry, and proxy model listing for the settings page.
 * Key literals cross the wire in one direction only — nothing here returns one.
 *
 * @module @deepseek-ai/dsh-llm-genspark/service
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { normalizeApiKey } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { describeExhaustion, MAX_KEY_SLOTS, NoKeysConfiguredError } from './rotation.ts'
import type { KeyRotation, KeySlot, RotationEvent } from './rotation.ts'

/** Credential reference prefix; slot N is stored under `${prefix}${N}`. */
export const GENSPARK_KEY_REF_PREFIX = 'GENSPARK_API_KEY_'

/**
 * Credential reference for one key slot.
 * @param slot - 1-based slot in 1..100.
 * @returns the reference name.
 */
export function gensparkKeyRef(slot: number): string {
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_KEY_SLOTS) {
    throw new RangeError(`genspark: key slot must be an integer in 1..${MAX_KEY_SLOTS}`)
  }
  return `${GENSPARK_KEY_REF_PREFIX}${slot}`
}

/** Every slot's credential reference, in slot order. */
export const GENSPARK_KEY_REFS: readonly string[] = Object.freeze(
  Array.from({ length: MAX_KEY_SLOTS }, (_, index) => gensparkKeyRef(index + 1)),
)

/**
 * Split pasted text into distinct keys: one per line (commas and whitespace
 * also separate), blank lines and `#` comments ignored.
 * @param text - pasted keys.
 * @returns distinct keys in paste order.
 * @throws Error when a key contains characters an HTTP header cannot carry.
 */
export function parseKeyList(text: string): string[] {
  const keys: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const content = line.trim()
    if (content.length === 0 || content.startsWith('#')) continue
    for (const token of content.split(/[\s,]+/)) {
      if (token.length === 0) continue
      const checked = normalizeApiKey(token)
      if (!checked.ok) throw new Error('genspark: one of the keys contains characters an HTTP header cannot carry')
      if (!keys.includes(checked.value)) keys.push(checked.value)
    }
  }
  return keys
}

/** Status of one slot, without the key literal. */
export interface GensparkKeySlotStatus {
  /** 1-based slot. */
  slot: number
  /** Credential reference holding the key. */
  ref: string
  /** Whether a key is stored. */
  configured: boolean
  /** Whether this is the key the next request uses. */
  active: boolean
  /** Last four characters of the key, for telling keys apart; absent when empty. */
  hint?: string
}

/** The last rotation this process performed. */
export interface GensparkRotationRecord {
  /** Abandoned slot. */
  from: number
  /** Slot now in use. */
  to: number
  /** Human-readable reason. */
  reason: string
  /** Whether the walk wrapped back to the first key. */
  wrapped: boolean
  /** Epoch milliseconds. */
  at: number
}

/** Rotation status for the settings page. */
export interface GensparkKeyStatus {
  /** Number of configured keys. */
  configured: number
  /** Slot the next request uses, when any key is configured. */
  activeSlot?: number
  /** Every slot, in order. */
  slots: GensparkKeySlotStatus[]
  /** The last rotation this process performed. */
  lastRotation?: GensparkRotationRecord
}

/** Result of a bulk key import. */
export interface GensparkImportResult {
  /** Keys stored. */
  stored: number
  /** Keys that did not fit into the remaining slots. */
  skipped: number
  /** Keys already present in some slot. */
  duplicates: number
}

/** Construction inputs supplied by the plugin. */
export interface GensparkKeysConfig {
  /** The shared rotation. */
  rotation: KeyRotation
  /** Configured slots, read fresh per call. */
  readSlots: () => Promise<readonly KeySlot[]>
  /** Current proxy endpoint. */
  baseURL: () => string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Genspark key-rotation status and control. */
    genspark: GensparkKeys
  }
  interface Events {
    /**
     * The Genspark route moved from one exhausted key to the next.
     * @param event - the slots involved and why.
     * @mode emit
     */
    'genspark/key-rotated'(event: RotationEvent): void
  }
}

/** Host service behind `ctx.remote.genspark`. */
export class GensparkKeys extends TypertRemoteService {
  private lastRotation: GensparkRotationRecord | undefined
  private readonly config: GensparkKeysConfig

  constructor(ctx: Context, config: GensparkKeysConfig) {
    super(ctx, 'genspark', { namespace: 'genspark' })
    this.config = config
    ctx.on('genspark/key-rotated', (event) => {
      this.lastRotation = {
        from: event.from, to: event.to, reason: describeExhaustion(event.reason), wrapped: event.wrapped, at: Date.now(),
      }
    })
  }

  /**
   * Describe every slot.
   * @returns configured count, the active slot, and per-slot presence.
   */
  @Remote
  async status(): Promise<GensparkKeyStatus> {
    const slots = await this.config.readSlots()
    const active = this.config.rotation.active(slots)
    const bySlot = new Map(slots.map(slot => [slot.slot, slot.key]))
    return {
      configured: slots.length,
      ...active === undefined ? {} : { activeSlot: active.slot },
      slots: GENSPARK_KEY_REFS.map((ref, index) => {
        const key = bySlot.get(index + 1)
        return {
          slot: index + 1,
          ref,
          configured: key !== undefined,
          active: active?.slot === index + 1,
          ...key === undefined ? {} : { hint: key.slice(-4) },
        }
      }),
      ...this.lastRotation === undefined ? {} : { lastRotation: this.lastRotation },
    }
  }

  /**
   * Make one slot the key the next request uses.
   * @param slot - 1-based slot.
   */
  @Remote
  select(slot: number): void {
    this.config.rotation.select(slot)
  }

  /**
   * Store pasted keys into empty slots in order (from slot 1 after clearing
   * every slot when `replace`).
   * @param text - keys separated by newlines, commas, or spaces.
   * @param replace - clear every slot first.
   * @returns stored / skipped / duplicate counts.
   */
  @Remote
  async importKeys(text: string, replace: boolean): Promise<GensparkImportResult> {
    const credentials = this.credentials()
    const keys = parseKeyList(text)
    if (replace) {
      for (const ref of GENSPARK_KEY_REFS) {
        if ((await credentials.describe(credentialRef(ref))).configured) await credentials.unset(credentialRef(ref))
      }
    }
    const existing = new Set(replace ? [] : (await this.config.readSlots()).map(slot => slot.key))
    let stored = 0
    let duplicates = 0
    let skipped = 0
    let slot = 1
    for (const key of keys) {
      if (existing.has(key)) {
        duplicates++
        continue
      }
      while (slot <= MAX_KEY_SLOTS && (await credentials.describe(credentialRef(gensparkKeyRef(slot)))).configured) slot++
      if (slot > MAX_KEY_SLOTS) {
        skipped++
        continue
      }
      await credentials.set(credentialRef(gensparkKeyRef(slot)), key)
      existing.add(key)
      stored++
      slot++
    }
    return { stored, skipped, duplicates }
  }

  /**
   * Store or replace the key in one slot.
   * @param slot - 1-based slot.
   * @param key - the key literal.
   */
  @Remote
  async setKey(slot: number, key: string): Promise<void> {
    const [parsed] = parseKeyList(key)
    if (parsed === undefined) throw new Error('genspark: the key is empty')
    await this.credentials().set(credentialRef(gensparkKeyRef(slot)), parsed)
  }

  /**
   * Remove the key in one slot.
   * @param slot - 1-based slot.
   */
  @Remote
  async removeKey(slot: number): Promise<void> {
    await this.credentials().unset(credentialRef(gensparkKeyRef(slot)))
  }

  /**
   * List the model ids the proxy currently advertises, using the active key.
   * @returns model ids in endpoint order.
   */
  @Remote
  async listRemoteModels(): Promise<string[]> {
    const slots = await this.config.readSlots()
    const slot = this.config.rotation.active(slots)
    if (slot === undefined) throw new NoKeysConfiguredError()
    const response = await fetch(`${this.config.baseURL().replace(/\/+$/, '')}/models`, {
      headers: { authorization: `Bearer ${slot.key}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`genspark: /models answered HTTP ${response.status}`)
    const body = await response.json() as { data?: Array<{ id?: unknown }> }
    return (body.data ?? []).flatMap(entry => typeof entry.id === 'string' ? [entry.id] : [])
  }

  private credentials(): CredentialProvider {
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) throw new Error('genspark: no credentials service is mounted to store keys in')
    return credentials
  }
}
