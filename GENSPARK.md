# DeepSeek Harness for Genspark API

This repository is [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **v0.2.1-alpha.2**
(tag `dsh-v0.2.1-alpha.2`, commit `d743267`), modified to run on the **Genspark API** (Genspark LLM proxy).
Everything not listed below is unchanged upstream code.

> 日本語の説明は下にあります / Japanese below.

## What changed

| Feature | Where |
|---|---|
| Genspark LLM proxy as the default model route (`genspark`, OpenAI-compatible, `https://www.genspark.ai/api/llm_proxy/v1`) | `packages/llm/llm-genspark` |
| Up to **100 API keys** (`GENSPARK_API_KEY_1` … `GENSPARK_API_KEY_100`), stored outside the settings file | `packages/llm/llm-genspark/src/service.ts` |
| **Immediate rotation**: when the key in use is spent, the same request is re-sent with the next key; after the last key, key 1 is used again | `packages/llm/llm-genspark/src/rotation.ts` |
| **Memory continuity**: a key change only alters the `Authorization` header; the request body (the whole conversation from the durable session log) is byte-identical, and the rejected attempt is never shown to the model | `rotation.ts`, `tests/adapter.spec.ts` |
| **One-click model and reasoning level** on Plugins → Genspark (chips, applied immediately), plus the existing composer model button | `packages/client/ui-settings-genspark` |
| **Automatic prompt when work stops** (on completion and/or on error, optionally on Stop), with a consecutive-send cap and a delay during which your own input wins. **Off by default.** | `packages/core/agent-auto-prompt` |
| Japanese UI language option, Desktop welcome screen accepts a Genspark key | `ui-settings-genspark`, `apps/desktop/src/welcome-backend.ts` |

Small supporting edits to upstream files: `llm-pi-ai` gained an optional per-route `resolveFetch` hook and a
`./profiles` subpath; bundles compose the new plugins and default to `genspark / gpt-5 / medium`; the model pickers
list Genspark first.

### How exhaustion is detected

The Genspark proxy answers a spent key with **HTTP 200** and the header `x-genspark-credit-wall`
(the body is a "please purchase credits" message). The rotating fetch inspects the response head before the body
reaches the model, so the credit notice never enters the conversation. HTTP 401 / 402 / 403 also rotate.
HTTP 429 and 5xx do **not** rotate; they go through the normal retry policy with backoff.
If every key is rejected in one full lap, the request fails with `QUOTA`. The next request resumes from the current key.
The current key number survives restarts (`~/.dsh/genspark/key-rotation.json`).

## Usage

1. Start the app (Desktop or `pnpm dsh web`).
2. Open **Plugins → Genspark**.
3. Paste your keys (one per line, up to 100) and press **Add keys**.
4. Click a **model** and a **reasoning level** chip. They apply immediately.
5. Optional: turn on **Automatic prompt**, write the prompt, and press **Save**.

Alternatively, export `GENSPARK_API_KEY` (one key) or `GENSPARK_API_KEY_1` … `_100` before launching.

## Building the Windows installer

Use the GitHub Actions workflow **Windows installer (Genspark, unsigned)** (`.github/workflows/windows-genspark.yml`).
Run it with **Run workflow**, then download the `.exe` artifact. Locally on Windows (Node 24, pnpm 11):

```powershell
pnpm install --frozen-lockfile
pnpm run package:desktop:win:x64:unsigned --build-version 0.2.1-alpha.2.genspark.1
# output: apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts/*.exe
```

---

## 日本語

DeepSeek Harness v0.2.1-alpha.2 を Genspark API で動くように改造したものです。下記以外は上流のコードのままです。

- **Genspark API を使用**: 既定のモデル経路を Genspark LLM プロキシにしました（OpenAI 互換）。
- **APIキーは最大100個**: プラグイン → Genspark の画面で、1行に1つずつ貼り付けて「キーを追加」を押します。
- **即座に次のキーへ切替**: 使用中のキーを使い切った瞬間に、同じリクエストを次のキーで送り直します。100個目（最後のキー）の次は1個目に戻ります。
  - Genspark はクレジット切れでも HTTP 200 を返し、`x-genspark-credit-wall` ヘッダで知らせます。これを本文より先に検出するため、「クレジットを購入してください」という文面が会話に混入しません。
  - 401 / 402 / 403 も切替の対象です。429（一時的な混雑）と 5xx は切り替えずに再試行します。
- **記憶は完全に引き継がれます**: 変わるのは認証ヘッダだけです。送信される会話履歴（セッションログ全体）はバイト単位で同一です。
- **モデル・推論レベルをワンクリックで設定**: 同じ画面のチップを押すとすぐ反映されます。入力欄のモデルボタンからも切り替えられます。
- **作業停止時の自動プロンプト（既定はオフ）**: 完了時やエラー時（任意で停止ボタン時）に、設定したプロンプトを自動で送信します。連続送信の上限と待ち時間を設定でき、待ち時間中に自分で入力すればそちらが優先されます。

Windows 版のインストーラは、GitHub Actions の「Windows installer (Genspark, unsigned)」を実行するとビルドされます。
