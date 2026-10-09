/**
 * Genspark settings page, node half. The empty apply exists so the plugin
 * appears in the host cordis.yml / Loader; the browser half owns the page
 * through exports["./client"]. The namespaces the page edits are registered
 * by `dsh-llm-genspark`, `dsh-agent-default-model`, and
 * `dsh-agent-auto-prompt`.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
