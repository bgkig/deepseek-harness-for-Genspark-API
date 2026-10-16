# @deepseek-ai/dsh-agent-auto-prompt

Sends a user-configured prompt when an agent's work stops. **Off by default.**

Triggers: turn `completed` / `max-tokens` (`onCompleted`), `error` (`onError`), and user Stop (`onUserStop`, off by default). Structural aborts (parent, disposal, hooks), blocked and crash-closed turns never trigger.

Guards: `maxConsecutive` sends without a human message (default 20, 0 = unlimited); `delayMs` wait during which any human input cancels the send; never fires while input is queued; subagent sessions are excluded unless `includeSubagents`.

The prompt is a normal user follow-up with source `{ kind: 'auto-prompt' }`, durably logged like any message. Configure it on Plugins → Genspark.
