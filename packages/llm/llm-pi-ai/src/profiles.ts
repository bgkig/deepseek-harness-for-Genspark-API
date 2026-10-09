/**
 * Profile resolution for compositions that build a pi-ai route themselves
 * (for example a fixed gateway route whose profile is derived from its own
 * settings) and hand the result to {@link PiAiAdapter}.
 *
 * @module @deepseek-ai/dsh-llm-pi-ai/profiles
 */
export { resolveProfiles } from './config.ts'
export type { PiAiProviderProfile, ResolvedPiAiProviderProfile } from './config.ts'
