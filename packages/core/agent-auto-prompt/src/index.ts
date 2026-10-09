/**
 * Automatic prompt on stop: when an agent's work stops — because its turn
 * completed or because it failed with an error — send a user-configured
 * prompt as the next message, so long-running work continues unattended.
 *
 * Off by default. Settings (all live, no restart):
 *
 * ```yaml
 * - id: agent-auto-prompt
 *   name: '@deepseek-ai/dsh-agent-auto-prompt'
 *   config:
 *     enabled: true
 *     onCompleted: true          # turn finished normally
 *     onError: true              # turn failed (provider error, exhausted keys…)
 *     onUserStop: false          # user pressed Stop
 *     completedPrompt: 'Continue.'
 *     errorPrompt: 'An error stopped you. Review it and continue.'
 *     maxConsecutive: 20         # 0 = unlimited; a human message resets it
 *     delayMs: 1500
 * ```
 *
 * The prompt enters through the agent's ordinary follow-up path as a user
 * message with source `auto-prompt`, so it is durably logged like any other
 * message and the model sees exactly what the log records.
 *
 * Guards against runaway loops: a consecutive-send cap reset by any message
 * the human sends, never firing while other input is queued, never firing for
 * subagent children unless asked, and a short delay during which the human's
 * own input wins.
 *
 * @module @deepseek-ai/dsh-agent-auto-prompt
 */
import type {} from '@deepseek-ai/dsh-settings'

import { FiberState } from '@deepseek-ai/cordis'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'

export const name = 'agent-auto-prompt'
export const inject = ['agents']

/** Why the agent stopped. */
export type AutoPromptTrigger = 'completed' | 'error' | 'user-stop'

/** Message attribution for an automatically sent prompt. */
export interface AutoPromptMessageSource {
  readonly kind: 'auto-prompt'
  /** Which stop triggered it. */
  readonly trigger: AutoPromptTrigger
  /** 1-based count within the current unattended run. */
  readonly sequence: number
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'auto-prompt': AutoPromptMessageSource
  }
}

/** Plugin configuration; every field is live. */
export interface Config {
  /** Master switch (default off). */
  enabled: Volatile<boolean>
  /** Send after a turn that completed normally. */
  onCompleted: Volatile<boolean>
  /** Send after a turn that ended with an error. */
  onError: Volatile<boolean>
  /** Send after the user cancelled the turn. */
  onUserStop: Volatile<boolean>
  /** Prompt sent after a completed turn. */
  completedPrompt: Volatile<string>
  /** Prompt sent after an error; empty reuses {@link completedPrompt}. */
  errorPrompt: Volatile<string>
  /** Maximum automatic sends in a row without a human message; 0 = unlimited. */
  maxConsecutive: Volatile<number>
  /** Wait before sending, so input the human types first wins (ms). */
  delayMs: Volatile<number>
  /** Also apply to subagent child sessions. */
  includeSubagents: Volatile<boolean>
}

/** Default prompt text. */
export const DEFAULT_AUTO_PROMPT = '続けてください。'

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false).volatile(),
  onCompleted: z.boolean().default(true).volatile(),
  onError: z.boolean().default(true).volatile(),
  onUserStop: z.boolean().default(false).volatile(),
  completedPrompt: z.string().default(DEFAULT_AUTO_PROMPT).volatile(),
  errorPrompt: z.string().default('').volatile(),
  maxConsecutive: z.natural().default(20).volatile(),
  delayMs: z.natural().max(600_000).default(1500).volatile(),
  includeSubagents: z.boolean().default(false).volatile(),
}) as unknown as z<Config>

/**
 * Map a durable turn-end reason to a trigger.
 * @param reason - the `turn/end` reason.
 * @returns the trigger, or undefined for stops that never auto-continue.
 */
export function triggerOf(reason: TurnEndReason): AutoPromptTrigger | undefined {
  switch (reason.kind) {
    case 'completed':
      return 'completed'
    case 'max-tokens':
      // The answer was cut off; continuing is exactly what a human would ask.
      return 'completed'
    case 'error':
      return 'error'
    case 'aborted':
      // Only a human pressing Stop counts; parent/disposal/hook aborts are
      // structural and must not be fought.
      return reason.reason.kind === 'user' ? 'user-stop' : undefined
    default:
      // blocked, interrupted, and plugin-defined reasons do not auto-continue.
      return undefined
  }
}

/** Per-agent bookkeeping. */
interface AgentState {
  /** Trigger of the turn that just ended, consumed at the next idle. */
  pending: AutoPromptTrigger | undefined
  /** Automatic sends since the last human message. */
  consecutive: number
  /** Scheduled send, cancellable by human input. */
  timer: ReturnType<typeof setTimeout> | undefined
}

/** Install the stop listener. */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })

  const states = new Map<Agent, AgentState>()
  const stateOf = (agent: Agent): AgentState => {
    let state = states.get(agent)
    if (state === undefined) {
      state = { pending: undefined, consecutive: 0, timer: undefined }
      states.set(agent, state)
    }
    return state
  }
  const cancelTimer = (state: AgentState): void => {
    if (state.timer !== undefined) clearTimeout(state.timer)
    state.timer = undefined
  }

  const wanted = (trigger: AutoPromptTrigger): boolean => {
    switch (trigger) {
      case 'completed': return config.onCompleted.get()
      case 'error': return config.onError.get()
      case 'user-stop': return config.onUserStop.get()
    }
  }
  const promptFor = (trigger: AutoPromptTrigger): string => {
    const errorPrompt = config.errorPrompt.get().trim()
    if (trigger === 'error' && errorPrompt.length > 0) return errorPrompt
    return config.completedPrompt.get().trim()
  }

  const eligible = (agent: Agent): boolean => ctx.fiber.state === FiberState.ACTIVE
    && config.enabled.get()
    && ctx.agents.get(agent.id) === agent
    && agent.status === 'idle'
    && agent.inbox.nextTurn.length === 0
    && agent.inbox.nextStep.length === 0
    && (config.includeSubagents.get() || agent.session.header.origin !== 'subagent')

  const fire = (agent: Agent, trigger: AutoPromptTrigger): void => {
    const state = stateOf(agent)
    state.timer = undefined
    if (!eligible(agent) || !wanted(trigger)) return
    const limit = config.maxConsecutive.get()
    if (limit > 0 && state.consecutive >= limit) {
      ctx.logger.info(`agent-auto-prompt: reached ${limit} automatic prompts in a row for "${agent.id}"; waiting for a human message`)
      return
    }
    const text = promptFor(trigger)
    if (text.length === 0) return
    state.consecutive++
    try {
      ctx.agents.withoutInitiator(() => {
        agent.followup(createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'auto-prompt', trigger, sequence: state.consecutive },
        }))
      })
    } catch (error) {
      state.consecutive--
      ctx.logger.warn(`agent-auto-prompt: could not send the prompt to "${agent.id}": ${String(error)}`)
    }
  }

  ctx.effect(function* () {
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      const agent = ctx.agents.get(session.id)
      if (agent === undefined || agent.session !== session) return
      const state = stateOf(agent)
      if (event.type === 'turn/end') {
        state.pending = triggerOf(event.data.reason)
      } else if (event.type === 'user/message' && event.data.source.kind !== 'auto-prompt') {
        // Any message the automation did not send resets the run.
        state.consecutive = 0
      }
    })

    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (message.source.kind === 'auto-prompt') return
      // Input queued during the delay wins over the automatic prompt.
      cancelTimer(stateOf(agent))
    })

    ctx.on('agent/status', ({ agent, status }) => {
      const state = stateOf(agent)
      if (status !== 'idle') {
        cancelTimer(state)
        return
      }
      const trigger = state.pending
      state.pending = undefined
      if (trigger === undefined || !config.enabled.get() || !wanted(trigger)) return
      cancelTimer(state)
      state.timer = setTimeout(() => { fire(agent, trigger) }, config.delayMs.get())
    })

    ctx.on('agent/disposed', ({ agent }) => {
      const state = states.get(agent)
      if (state !== undefined) cancelTimer(state)
      states.delete(agent)
    })

    yield () => {
      for (const state of states.values()) cancelTimer(state)
      states.clear()
    }
  }, 'agent-auto-prompt lifecycle')
}
