/**
 * The Genspark model catalog: the models the proxy serves and the reasoning
 * levels each one offers. The list is the default for the `models` setting;
 * a user can add or remove models on the Genspark settings page, and models
 * the proxy lists at `/models` but this table does not know are offered there
 * for one-click adoption.
 *
 * @module @deepseek-ai/dsh-llm-genspark/models
 */

/** pi-ai's reasoning levels, in escalation order. */
export const GENSPARK_REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One selectable reasoning level. */
export type GensparkReasoningLevel = typeof GENSPARK_REASONING_LEVELS[number]

/** One model entry of the `models` setting. */
export interface GensparkModel {
  /** Model id the proxy accepts. */
  id: string
  /** Display name; defaults to the id. */
  name?: string
  /**
   * Reasoning levels offered for this model, least to greatest. Empty means a
   * non-reasoning model (no effort control is shown).
   */
  reasoning?: GensparkReasoningLevel[]
  /** Context window in tokens. */
  contextWindow?: number
  /** Output-token capability. */
  maxTokens?: number
  /** Whether the model accepts image input. */
  vision?: boolean
}

const OPENAI_REASONING = (): GensparkReasoningLevel[] => ['minimal', 'low', 'medium', 'high']
const STANDARD_REASONING = (): GensparkReasoningLevel[] => ['off', 'low', 'medium', 'high']
const CODEX_REASONING = (): GensparkReasoningLevel[] => ['low', 'medium', 'high']

/** Models offered out of the box, most generally useful first. */
export const DEFAULT_GENSPARK_MODELS: readonly GensparkModel[] = [
  { id: 'gpt-5', name: 'GPT-5', reasoning: OPENAI_REASONING(), contextWindow: 400_000, maxTokens: 128_000, vision: true },
  { id: 'gpt-5.1', name: 'GPT-5.1', reasoning: OPENAI_REASONING(), contextWindow: 400_000, maxTokens: 128_000, vision: true },
  { id: 'gpt-5.2', name: 'GPT-5.2', reasoning: OPENAI_REASONING(), contextWindow: 400_000, maxTokens: 128_000, vision: true },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', reasoning: OPENAI_REASONING(), contextWindow: 400_000, maxTokens: 128_000, vision: true },
  { id: 'gpt-5-nano', name: 'GPT-5 nano', reasoning: OPENAI_REASONING(), contextWindow: 400_000, maxTokens: 128_000, vision: true },
  { id: 'gpt-5-codex', name: 'GPT-5 Codex', reasoning: CODEX_REASONING(), contextWindow: 400_000, maxTokens: 128_000 },
  { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex', reasoning: CODEX_REASONING(), contextWindow: 400_000, maxTokens: 128_000 },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', reasoning: CODEX_REASONING(), contextWindow: 400_000, maxTokens: 128_000 },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', reasoning: STANDARD_REASONING(), contextWindow: 200_000, maxTokens: 64_000, vision: true },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', reasoning: STANDARD_REASONING(), contextWindow: 200_000, maxTokens: 64_000, vision: true },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', reasoning: STANDARD_REASONING(), contextWindow: 200_000, maxTokens: 64_000, vision: true },
  { id: 'deep-seek-v4-pro', name: 'DeepSeek V4 Pro', reasoning: STANDARD_REASONING(), contextWindow: 128_000, maxTokens: 32_768 },
  { id: 'deep-seek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: STANDARD_REASONING(), contextWindow: 128_000, maxTokens: 32_768 },
]

/** The model selected when nothing else is configured. */
export const DEFAULT_GENSPARK_MODEL = 'gpt-5'

/**
 * Display name for a reasoning level.
 * @param level - level id.
 * @returns capitalized name.
 */
export function reasoningLevelName(level: string): string {
  return level.length === 0 ? level : `${level.charAt(0).toUpperCase()}${level.slice(1)}`
}

/**
 * Translate one catalog entry to the pi-ai model profile the shared adapter
 * understands. A level list becomes `reasoningEfforts` whose wire spelling is
 * the level itself (`off` sends nothing).
 * @param model - the Genspark entry.
 * @returns the pi-ai model profile.
 */
export function toPiAiModel(
  model: Readonly<Omit<GensparkModel, 'reasoning'>> & { readonly reasoning?: readonly GensparkReasoningLevel[] | undefined },
): Record<string, unknown> {
  const levels = (model.reasoning ?? []).filter(level => GENSPARK_REASONING_LEVELS.includes(level))
  const thinking = levels.filter(level => level !== 'off')
  return {
    id: model.id,
    name: model.name !== undefined && model.name.length > 0 ? model.name : model.id,
    ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    input: model.vision === true ? ['text', 'image'] : ['text'],
    reasoningEfforts: thinking.length === 0
      ? false
      : Object.fromEntries(levels.map(level => [level, level === 'off' ? null : level])),
  }
}
