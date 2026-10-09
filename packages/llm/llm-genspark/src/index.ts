/**
 * Genspark LLM proxy provider route (`genspark`) with up to 100 API keys.
 *
 * The plugin is a thin composition over the existing pi-ai adapter: it builds
 * one hand-declared OpenAI-compatible route pointed at the Genspark proxy and
 * hands the adapter a fetch that authenticates every wire request with the
 * current key, re-sending the identical request with the next key the moment
 * the proxy reports the current one spent (see `rotation.ts`). After the last
 * configured key the walk returns to key 1.
 *
 * Keys are stored through the harness credential seam under the references
 * `GENSPARK_API_KEY_1` … `GENSPARK_API_KEY_100` — never in the settings
 * document — and are read per request, so adding or removing a key applies to
 * the next request without a restart.
 *
 * Memory continuity: the conversation lives in the durable session log, which
 * every request re-sends in full. A key change only alters the Authorization
 * header of one HTTP request; the request body (the whole history) is the
 * same bytes, so nothing the agent knows is lost when keys rotate.
 *
 * ```yaml
 * - id: llm-genspark
 *   name: '@deepseek-ai/dsh-llm-genspark'
 *   config:
 *     baseURL: https://www.genspark.ai/api/llm_proxy/v1
 *     reasoning: medium
 * ```
 *
 * @module @deepseek-ai/dsh-llm-genspark
 */
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-fs'

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { LlmError, normalizeApiKey, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai/profiles'
import type { PiAiProviderProfile, ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai/profiles'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { DEFAULT_GENSPARK_MODELS, GENSPARK_REASONING_LEVELS, toPiAiModel } from './models.ts'
import type { GensparkModel, GensparkReasoningLevel } from './models.ts'
import {
  AllKeysExhaustedError, describeExhaustion, KeyRotation, MAX_KEY_SLOTS, NoKeysConfiguredError, rotatingFetch,
} from './rotation.ts'
import type { KeySlot, RotationStateStore } from './rotation.ts'
import { GENSPARK_KEY_REFS, GensparkKeys } from './service.ts'

export {
  AllKeysExhaustedError, CREDIT_WALL_HEADER, describeExhaustion, exhaustionOf, KeyRotation, MAX_KEY_SLOTS,
  memoryRotationStore, NoKeysConfiguredError, rotatingFetch,
} from './rotation.ts'
export type { ExhaustionReason, KeySlot, RotatingFetchOptions, RotationEvent, RotationStateStore } from './rotation.ts'
export {
  DEFAULT_GENSPARK_MODEL, DEFAULT_GENSPARK_MODELS, GENSPARK_REASONING_LEVELS, reasoningLevelName, toPiAiModel,
} from './models.ts'
export type { GensparkModel, GensparkReasoningLevel } from './models.ts'
export { GENSPARK_KEY_REF_PREFIX, GENSPARK_KEY_REFS, GensparkKeys, gensparkKeyRef, parseKeyList } from './service.ts'
export type {
  GensparkImportResult, GensparkKeysConfig, GensparkKeySlotStatus, GensparkKeyStatus, GensparkRotationRecord,
} from './service.ts'

export const name = 'llm-genspark'
export const inject = ['llm']

/** Provider route this plugin registers. */
export const GENSPARK_PROVIDER = 'genspark'

/** Default Genspark LLM proxy endpoint (OpenAI-compatible). */
export const DEFAULT_GENSPARK_BASE_URL = 'https://www.genspark.ai/api/llm_proxy/v1'

/** Placeholder pi-ai puts in the Authorization header; the rotating fetch replaces it. */
const PLACEHOLDER_KEY = 'genspark-rotating-key'

/** Plugin configuration. */
export interface Config {
  /** Proxy endpoint. */
  baseURL: Volatile<string>
  /** Display name of the provider group in model pickers. */
  displayName: Volatile<string>
  /** Models offered; replaces the built-in list when set. */
  models: Volatile<GensparkModel[]>
  /** Default reasoning level for models that support it. */
  reasoning: Volatile<GensparkReasoningLevel | undefined>
  /** Maximum provider idle time while one stream read is outstanding (ms). */
  streamIdleTimeoutMs: Volatile<number>
  /** File holding the current key slot, so a restart resumes on the same key. */
  stateFile: string
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  baseURL: z.string().default(DEFAULT_GENSPARK_BASE_URL).volatile(),
  displayName: z.string().default('Genspark').volatile(),
  models: z.array(z.object({
    id: z.string().required(),
    name: z.string(),
    reasoning: z.array(z.union(GENSPARK_REASONING_LEVELS)),
    contextWindow: z.natural().min(1),
    maxTokens: z.natural().min(1),
    vision: z.boolean(),
  })).default(DEFAULT_GENSPARK_MODELS.map(model => structuredClone(model))).volatile(),
  reasoning: z.union(GENSPARK_REASONING_LEVELS).volatile(),
  streamIdleTimeoutMs: z.natural().min(1).default(300_000).volatile(),
  stateFile: z.string().default(dshHomePath('genspark', 'key-rotation.json')),
}) as unknown as z<Config>

/**
 * Persist the slot pointer as a tiny JSON file (atomic rename); a failure only
 * costs resume-after-restart, never a request.
 * @param path - state file.
 * @param warn - logger for write failures.
 * @returns the store.
 */
export function fileRotationStore(path: string, warn: (message: string) => void): RotationStateStore {
  return {
    load() {
      try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
        const slot = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'slot') : undefined
        return typeof slot === 'number' && Number.isInteger(slot) && slot >= 1 && slot <= MAX_KEY_SLOTS ? slot : undefined
      } catch {
        // Absent or unreadable state starts at the first configured key.
        return undefined
      }
    },
    save(slot) {
      try {
        mkdirSync(dirname(path), { recursive: true })
        const temporary = `${path}.${process.pid}.tmp`
        writeFileSync(temporary, `${JSON.stringify({ slot, updatedAt: new Date().toISOString() })}\n`)
        renameSync(temporary, path)
      } catch (error) {
        warn(`genspark: could not persist the current key slot (${String(error)}); a restart starts from key 1`)
      }
    },
  }
}

/**
 * Build the single pi-ai profile describing the Genspark route.
 * @param config - live plugin configuration.
 * @returns the profile.
 */
export function gensparkProfile(
  config: Pick<Config, 'baseURL' | 'displayName' | 'models' | 'reasoning' | 'streamIdleTimeoutMs'>,
): PiAiProviderProfile {
  const models = config.models.get()
  const reasoning = config.reasoning.get()
  return {
    displayName: config.displayName.get(),
    api: 'openai-completions',
    baseURL: config.baseURL.get(),
    models: (models.length > 0 ? models : DEFAULT_GENSPARK_MODELS)
      .map(model => toPiAiModel(model)) as unknown as NonNullable<PiAiProviderProfile['models']>,
    compat: {
      // The proxy forwards OpenAI-style reasoning_effort to every backend and
      // accepts max_completion_tokens; developer-role and store are OpenAI-only.
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsReasoningEffort: true,
      supportsUsageInStreaming: true,
      thinkingFormat: 'openai',
      maxTokensField: 'max_completion_tokens',
    },
    ...reasoning === undefined ? {} : { reasoning },
    streamIdleTimeoutMs: config.streamIdleTimeoutMs.get(),
    // Failures rotation cannot fix (rate limits, 5xx, dropped streams) retry
    // with backoff; an exhausted key never reaches here — it rotates first.
    retryPolicy: { mode: 'normal', maxRetries: 8 },
  }
}

/** Register the Genspark route with rotating keys. */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })

  const readSlots = async (): Promise<readonly KeySlot[]> => {
    const credentials = ctx.get('credentials')
    const environment = launchEnvironmentOf(ctx)
    const values = await Promise.all(GENSPARK_KEY_REFS.map(async ref => credentials !== undefined
      ? (await credentials.resolve(credentialRef(ref)))?.value
      : environment.get(ref)?.value))
    const slots: KeySlot[] = []
    values.forEach((value, index) => {
      if (value === undefined) return
      const checked = normalizeApiKey(value)
      if (checked.ok) slots.push({ slot: index + 1, key: checked.value })
    })
    // One exported GENSPARK_API_KEY seeds slot 1 when no numbered key exists,
    // so a fresh install works before the settings page is visited.
    if (slots.length === 0) {
      const fallback = environment.get('GENSPARK_API_KEY')?.value
      const checked = fallback === undefined ? undefined : normalizeApiKey(fallback)
      if (checked?.ok === true) slots.push({ slot: 1, key: checked.value })
    }
    return slots
  }

  const rotation = new KeyRotation(
    fileRotationStore(config.stateFile, message => ctx.logger.warn(message)),
    (event) => {
      ctx.logger.info(
        `genspark: key ${event.from} rejected (${describeExhaustion(event.reason)}); switched to key ${event.to}`
        + (event.wrapped ? ' (returned to the first key)' : ''),
      )
      ctx.emit('genspark/key-rotated', event)
    },
  )
  const fetchImpl = rotatingFetch({ slots: readSlots, rotation })
  const guardedFetch: typeof globalThis.fetch = async (input, init) => {
    try {
      return await fetchImpl(input, init)
    } catch (error) {
      if (error instanceof AllKeysExhaustedError) throw new LlmError(error.message, 'QUOTA', { cause: error })
      if (error instanceof NoKeysConfiguredError) throw new LlmError(error.message, 'MISSING_CREDENTIAL', { cause: error })
      throw error
    }
  }

  let lastRaw: unknown
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = gensparkProfile(config)
    if (memoized !== undefined && deepEqualJson(raw, lastRaw)) return memoized
    memoized = resolveProfiles({ [GENSPARK_PROVIDER]: structuredClone(raw) }, 'deferred')
    lastRaw = raw
    return memoized
  }
  profiles()

  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey: async () => {
      if ((await readSlots()).length === 0) throw new LlmError(new NoKeysConfiguredError().message, 'MISSING_CREDENTIAL')
      return PLACEHOLDER_KEY
    },
    resolveFetch: () => guardedFetch,
    auth: {
      credentials: {
        read: () => Promise.resolve(undefined),
        list: () => Promise.resolve([]),
        modify: () => Promise.reject(new Error('genspark keys are managed on the Genspark settings page')),
        delete: () => Promise.resolve(),
      },
      authContext: {
        env: variable => Promise.resolve(launchEnvironmentOf(ctx).get(variable)?.value),
        fileExists: () => Promise.resolve(false),
      },
    },
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    onReplayDegrade: ({ model, reason }) => {
      ctx.logger.warn(`genspark: unusable replay state for model "${model}"; sending provider-neutral content (${reason})`)
    },
  })

  // The registry captures the display name at registration; re-register when it changes.
  let registration: AdapterRegistrationHandle | undefined
  let registeredName: string | undefined
  const ensureRegistration = (): void => {
    const displayName = config.displayName.get()
    if (registration !== undefined && registeredName === displayName) return
    registration?.()
    registration = ctx.llm.registerAdapter([GENSPARK_PROVIDER], adapter)
    registeredName = displayName
  }
  ensureRegistration()

  ctx.plugin(GensparkKeys, { rotation, readSlots, baseURL: () => config.baseURL.get() })

  ctx.on('loader/volatile-update', () => {
    try { ensureRegistration() } catch (error) {
      ctx.logger.error('genspark: could not refresh the provider registration')
      ctx.logger.error(error)
    }
  })
}
