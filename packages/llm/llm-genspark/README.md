# @deepseek-ai/dsh-llm-genspark

Genspark LLM proxy route (`genspark`) with up to 100 rotating API keys.

- Keys: credential references `GENSPARK_API_KEY_1` … `GENSPARK_API_KEY_100` (edited on Plugins → Genspark; a lone exported `GENSPARK_API_KEY` seeds slot 1).
- Rotation: a response carrying `x-genspark-credit-wall` (the proxy answers a spent key with HTTP 200 and a credit notice) or HTTP 401/402/403 re-sends the identical request with the next configured key before any byte reaches the model; after the last key the walk wraps to the first. HTTP 429/5xx are left to `dsh-llm-retry`.
- The current slot persists in `stateFile` (default `$DSH_HOME/genspark/key-rotation.json`).
- Memory: only the Authorization header changes between attempts; the request body (full history from the durable session log) is resent unchanged.
- `ctx.remote.genspark`: `status`, `select`, `importKeys`, `setKey`, `removeKey`, `listRemoteModels` — no method returns a key literal.

| Config | Default |
|---|---|
| `baseURL` | `https://www.genspark.ai/api/llm_proxy/v1` |
| `displayName` | `Genspark` |
| `models` | built-in list (`src/models.ts`) |
| `reasoning` | per-request / model default |
| `streamIdleTimeoutMs` | `300000` |
| `stateFile` | `$DSH_HOME/genspark/key-rotation.json` |
