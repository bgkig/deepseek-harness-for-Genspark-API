/**
 * State behind the Genspark settings page: key-slot status over
 * `ctx.remote.genspark`, the default model and reasoning level over the
 * `agent-default-model` entry, the Genspark model list over the
 * `llm-genspark` entry, and the automatic-prompt settings over the
 * `agent-auto-prompt` entry.
 *
 * Model and reasoning changes are written the moment they are picked — a
 * one-click change is what "smooth" means for a selector — while free text
 * (prompts) is staged and written on Save.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-llm-genspark/remote'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Key-slot status as the Host reports it (mirrors dsh-llm-genspark `GensparkKeyStatus`). */
export interface GensparkKeyStatus {
  configured: number
  activeSlot?: number
  slots: Array<{ slot: number; ref: string; configured: boolean; active: boolean; hint?: string }>
  lastRotation?: { from: number; to: number; reason: string; wrapped: boolean; at: number }
}

/** Bulk import result (mirrors dsh-llm-genspark `GensparkImportResult`). */
export interface GensparkImportResult { stored: number; skipped: number; duplicates: number }

/** The `genspark` Remote namespace the Host plugin serves (see dsh-llm-genspark/service.ts). */
export interface GensparkRemote {
  status(): Promise<RemoteResult<GensparkKeyStatus>>
  select(slot: number): Promise<RemoteResult<void>>
  importKeys(text: string, replace: boolean): Promise<RemoteResult<GensparkImportResult>>
  removeKey(slot: number): Promise<RemoteResult<void>>
  listRemoteModels(): Promise<RemoteResult<string[]>>
}

/** Event subscription surface shared by the gateway client. */
interface RemoteEvents { $on(event: string, listener: () => void): () => void }

/** Settings namespaces this page edits. */
export const GENSPARK_NS = 'llm-genspark'
export const DEFAULT_MODEL_NS = 'agent-default-model'
export const AUTO_PROMPT_NS = 'agent-auto-prompt'

/** Provider route the Genspark plugin registers. */
export const GENSPARK_PROVIDER = 'genspark'

/** pi-ai reasoning levels, least to greatest. */
export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One Genspark model entry as stored. */
export interface GensparkModelEntry {
  id: string
  name?: string
  reasoning?: string[]
  contextWindow?: number
  maxTokens?: number
  vision?: boolean
}

/** The `llm-genspark` section fields the page reads. */
interface GensparkSection { models?: GensparkModelEntry[] }

/** The `agent-default-model` section. */
interface DefaultModelSection { provider?: string; model?: string; reasoningEffort?: string }

/** The `agent-auto-prompt` section. */
export interface AutoPromptSection {
  enabled?: boolean
  onCompleted?: boolean
  onError?: boolean
  onUserStop?: boolean
  completedPrompt?: string
  errorPrompt?: string
  maxConsecutive?: number
  delayMs?: number
  includeSubagents?: boolean
}

/** One key slot as the page shows it. */
export interface KeySlotView { slot: number; configured: boolean; active: boolean; hint?: string }

/** A status line under a section. */
export interface PageMessage { kind: 'ok' | 'error'; text: string }

/** Everything the page renders. */
export interface GensparkPageState {
  /** Whether the Host serves the Genspark namespace. */
  available: boolean
  /** Whether settings writes are accepted. */
  writable: boolean
  keys: {
    configured: number
    activeSlot: number | undefined
    slots: KeySlotView[]
    lastRotation: { from: number; to: number; reason: string; wrapped: boolean } | undefined
    /** Pasted text staged for import. */
    draft: string
    busy: boolean
    message: PageMessage | undefined
    showAll: boolean
  }
  model: {
    models: GensparkModelEntry[]
    selected: string | undefined
    effort: string | undefined
    busy: boolean
    proxyModels: string[] | undefined
    proxyFailed: boolean
  }
  auto: {
    /** Stored values. */
    value: Required<AutoPromptSection>
    /** Staged text edits. */
    draft: AutoDraft
    dirty: boolean
    busy: boolean
    message: PageMessage | undefined
  }
}

/** Staged text fields of the automatic-prompt form. */
export interface AutoDraft { completedPrompt: string; errorPrompt: string; maxConsecutive: string; delaySeconds: string }

const AUTO_DEFAULTS: Required<AutoPromptSection> = {
  enabled: false, onCompleted: true, onError: true, onUserStop: false,
  completedPrompt: '続けてください。', errorPrompt: '', maxConsecutive: 20, delayMs: 1500, includeSubagents: false,
}

/** Minimal shape of a bound settings form, as `ctx.configForms.get` returns it. */
interface FormLike<T> {
  getSnapshot(): { status: string; value: T | undefined; writable: boolean }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
}

/** Actions the page invokes. */
export interface GensparkPageActions {
  editKeys(text: string): void
  importKeys(replace: boolean): void
  selectSlot(slot: number): void
  removeSlot(slot: number): void
  toggleShowAll(): void
  selectModel(id: string): void
  selectEffort(effort: string): void
  loadProxyModels(): void
  addProxyModel(id: string): void
  setAutoFlag(field: 'enabled' | 'onCompleted' | 'onError' | 'onUserStop' | 'includeSubagents', value: boolean): void
  editAuto(field: keyof AutoDraft, text: string): void
  saveAuto(): void
}

/** Copy the controller needs for status messages. */
export interface ControllerCopy {
  added: (stored: number, duplicates: number, skipped: number) => string
  keysFailed: () => string
  saved: () => string
  saveFailed: () => string
}

/** Bridges three settings entries and the Genspark remote onto one page. */
export class GensparkPageController {
  readonly store: SnapshotStore<GensparkPageState>
  private readonly disposers: Array<() => void> = []
  private readonly genspark: FormLike<GensparkSection>
  private readonly defaults: FormLike<DefaultModelSection>
  private readonly auto: FormLike<AutoPromptSection>

  private readonly remote: GensparkRemote

  constructor(ctx: ClientContext, private readonly copy: ControllerCopy) {
    // The generated `./remote` contribution types this namespace at build time;
    // the explicit face keeps this file checkable without that artifact.
    this.remote = (ctx.remote as unknown as { genspark: GensparkRemote }).genspark
    const events = ctx.remote as unknown as RemoteEvents
    this.genspark = ctx.configForms.get<GensparkSection>(GENSPARK_NS) as unknown as FormLike<GensparkSection>
    this.defaults = ctx.configForms.get<DefaultModelSection>(DEFAULT_MODEL_NS) as unknown as FormLike<DefaultModelSection>
    this.auto = ctx.configForms.get<AutoPromptSection>(AUTO_PROMPT_NS) as unknown as FormLike<AutoPromptSection>
    const autoValue = this.autoValue()
    this.store = createSnapshotStore<GensparkPageState>({
      available: false,
      writable: false,
      keys: { configured: 0, activeSlot: undefined, slots: [], lastRotation: undefined, draft: '', busy: false, message: undefined, showAll: false },
      model: { models: [], selected: undefined, effort: undefined, busy: false, proxyModels: undefined, proxyFailed: false },
      auto: { value: autoValue, draft: draftOf(autoValue), dirty: false, busy: false, message: undefined },
    })
    for (const form of [this.genspark, this.defaults, this.auto]) {
      this.disposers.push(form.subscribe(() => { this.syncForms() }))
    }
    this.disposers.push(events.$on('genspark/key-rotated', () => { void this.refreshKeys() }))
    this.disposers.push(events.$on('credentials/reference-updated', () => { void this.refreshKeys() }))
    this.syncForms()
    void this.refreshKeys()
  }

  private autoValue(): Required<AutoPromptSection> {
    return { ...AUTO_DEFAULTS, ...this.auto.getSnapshot().value }
  }

  private patch(update: (state: GensparkPageState) => GensparkPageState): void {
    this.store.set(update(this.store.getSnapshot()))
  }

  private syncForms(): void {
    const gensparkSnapshot = this.genspark.getSnapshot()
    const defaults = this.defaults.getSnapshot().value
    const autoValue = this.autoValue()
    this.patch((state) => {
      const isGenspark = defaults?.provider === GENSPARK_PROVIDER
      return {
        ...state,
        available: gensparkSnapshot.status === 'ready',
        writable: gensparkSnapshot.writable,
        model: {
          ...state.model,
          models: gensparkSnapshot.value?.models ?? [],
          selected: isGenspark ? defaults?.model : undefined,
          effort: isGenspark ? defaults?.reasoningEffort : undefined,
        },
        auto: {
          ...state.auto,
          value: autoValue,
          // Keep what the user is typing; re-seed only a clean form.
          draft: state.auto.dirty ? state.auto.draft : draftOf(autoValue),
        },
      }
    })
  }

  /** Re-read the key-slot status from the Host. */
  async refreshKeys(): Promise<void> {
    const result = await this.remote.status()
    if (!result.ok) return
    const status = result.value
    this.patch(state => ({
      ...state,
      keys: {
        ...state.keys,
        configured: status.configured,
        activeSlot: status.activeSlot,
        slots: status.slots.map((slot): KeySlotView => ({
          slot: slot.slot, configured: slot.configured, active: slot.active, ...slot.hint === undefined ? {} : { hint: slot.hint },
        })),
        lastRotation: status.lastRotation ?? state.keys.lastRotation,
      },
    }))
  }

  /** @returns the actions bound to this controller. */
  actions(): GensparkPageActions {
    return {
      editKeys: (text) => { this.patch(state => ({ ...state, keys: { ...state.keys, draft: text } })) },
      importKeys: (replace) => { void this.importKeys(replace) },
      selectSlot: (slot) => { void this.remote.select(slot).then(() => this.refreshKeys()) },
      removeSlot: (slot) => { void this.remote.removeKey(slot).then(() => this.refreshKeys()) },
      toggleShowAll: () => { this.patch(state => ({ ...state, keys: { ...state.keys, showAll: !state.keys.showAll } })) },
      selectModel: (id) => { void this.selectModel(id) },
      selectEffort: (effort) => { void this.selectEffort(effort) },
      loadProxyModels: () => { void this.loadProxyModels() },
      addProxyModel: (id) => { void this.addProxyModel(id) },
      setAutoFlag: (field, value) => { void this.auto.set(field, value) },
      editAuto: (field, text) => {
        this.patch(state => ({ ...state, auto: { ...state.auto, dirty: true, message: undefined, draft: { ...state.auto.draft, [field]: text } } }))
      },
      saveAuto: () => { void this.saveAuto() },
    }
  }

  private async importKeys(replace: boolean): Promise<void> {
    const text = this.store.getSnapshot().keys.draft
    if (text.trim().length === 0) return
    this.patch(state => ({ ...state, keys: { ...state.keys, busy: true, message: undefined } }))
    const result = await this.remote.importKeys(text, replace)
    if (result.ok) {
      const { stored, duplicates, skipped } = result.value
      this.patch(state => ({ ...state, keys: { ...state.keys, busy: false, draft: '', message: { kind: 'ok', text: this.copy.added(stored, duplicates, skipped) } } }))
      await this.refreshKeys()
    } else {
      this.patch(state => ({ ...state, keys: { ...state.keys, busy: false, message: { kind: 'error', text: this.copy.keysFailed() } } }))
    }
  }

  /** Default effort for a model: the current one when still offered, else medium / high / the last level. */
  private effortFor(model: GensparkModelEntry | undefined, current: string | undefined): string | undefined {
    const levels = model?.reasoning ?? []
    if (levels.length === 0) return undefined
    if (current !== undefined && levels.includes(current)) return current
    return ['medium', 'high'].find(level => levels.includes(level)) ?? levels[levels.length - 1]
  }

  private async writeDefault(model: string, effort: string | undefined): Promise<void> {
    this.patch(state => ({ ...state, model: { ...state.model, busy: true, selected: model, effort } }))
    try {
      await this.defaults.set('provider', GENSPARK_PROVIDER)
      await this.defaults.set('model', model)
      if (effort === undefined) await this.defaults.unset('reasoningEffort')
      else await this.defaults.set('reasoningEffort', effort)
    } finally {
      this.patch(state => ({ ...state, model: { ...state.model, busy: false } }))
    }
  }

  private async selectModel(id: string): Promise<void> {
    const state = this.store.getSnapshot()
    const model = state.model.models.find(entry => entry.id === id)
    await this.writeDefault(id, this.effortFor(model, state.model.effort))
  }

  private async selectEffort(effort: string): Promise<void> {
    const selected = this.store.getSnapshot().model.selected
    if (selected === undefined) return
    await this.writeDefault(selected, effort)
  }

  private async loadProxyModels(): Promise<void> {
    const result = await this.remote.listRemoteModels()
    this.patch(state => ({
      ...state,
      model: { ...state.model, proxyModels: result.ok ? result.value : undefined, proxyFailed: !result.ok },
    }))
  }

  private async addProxyModel(id: string): Promise<void> {
    const models = this.store.getSnapshot().model.models
    if (models.some(model => model.id === id)) return
    const guess: GensparkModelEntry = /^(gpt|o\d)/.test(id)
      ? { id, reasoning: ['minimal', 'low', 'medium', 'high'] }
      : /no-think|nano|haiku|mini$/.test(id)
        ? { id }
        : { id, reasoning: ['off', 'low', 'medium', 'high'] }
    await this.genspark.set('models', [...models, guess])
  }

  private async saveAuto(): Promise<void> {
    const { draft } = this.store.getSnapshot().auto
    const max = Number.parseInt(draft.maxConsecutive, 10)
    const delay = Number.parseFloat(draft.delaySeconds)
    this.patch(state => ({ ...state, auto: { ...state.auto, busy: true, message: undefined } }))
    let ok = await this.auto.set('completedPrompt', draft.completedPrompt)
    ok = ok && await this.auto.set('errorPrompt', draft.errorPrompt)
    if (Number.isFinite(max) && max >= 0) ok = ok && await this.auto.set('maxConsecutive', max)
    if (Number.isFinite(delay) && delay >= 0) ok = ok && await this.auto.set('delayMs', Math.round(delay * 1000))
    this.patch(state => ({
      ...state,
      auto: {
        ...state.auto, busy: false, dirty: !ok,
        message: ok ? { kind: 'ok', text: this.copy.saved() } : { kind: 'error', text: this.copy.saveFailed() },
      },
    }))
    if (ok) this.syncForms()
  }

  /** Release subscriptions. */
  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose()
  }
}

function draftOf(value: Required<AutoPromptSection>): AutoDraft {
  return {
    completedPrompt: value.completedPrompt,
    errorPrompt: value.errorPrompt,
    maxConsecutive: String(value.maxConsecutive),
    delaySeconds: String(value.delayMs / 1000),
  }
}
