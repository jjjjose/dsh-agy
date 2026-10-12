# dsh-agy

**Google Antigravity (Cloud Code Assist) LLM provider plugin for [DeepSeek Harness](https://github.com/deepseek-ai).**

Sign in with your Google account and use the models from your **Antigravity Coding Plan** — Gemini, Claude, and GPT-OSS — as a first-class provider inside DeepSeek Harness (Desktop or Web UI). Works on **Windows, macOS, and Linux** with zero manual OAuth setup: the Google application identity is embedded, so you never have to create your own client or edit a config file.

> Status: developer preview. It talks to Google's internal Cloud Code Assist endpoints, exactly like the Antigravity IDE does.

---

## Features

- **One-click Google login** — OAuth (PKCE) through a localhost callback; no client id/secret to configure.
- **Multi-account + rotation** — add several Google accounts; requests rotate automatically using health scoring, a token bucket, and sticky selection. Rate-limited (429) accounts cool down and the request retries on the next account.
- **Streaming inference** — native `v1internal:streamGenerateContent?alt=sse` transport that surfaces text, thinking, and tool-call blocks, preserving Gemini thought signatures.
- **Live model catalog** — the visible model list is reconciled with your account's `fetchAvailableModels`, so models Google retires disappear automatically.
- **Quota view** — see your dual-window (5h + weekly) usage per account from the plugin settings page.
- **Settings UI** — a plugin page inside the Harness plugin manager to sign in, switch/remove accounts, and check quota.
- **Windows-first** — no dependence on a macOS `.app` bundle; headers identify the real host platform.

## Install

### DeepSeek Desktop (recommended)

1. Open **Plugins → Add plugin**.
2. Add this package (from a local folder, a git URL, or npm once published).
3. The prebuilt `lib/` is committed, so there is **no build step**.
4. Open **Plugins → Google Antigravity** and click **Conectar con Google**.
5. Complete authorization, then select a model under **Google Antigravity** in the conversation model picker.

The settings page provides an authorization link if the browser blocks the popup, account activation/removal, quota queries, model refresh and runtime activity. Follow [`docs/VALIDATION.md`](docs/VALIDATION.md) to check the complete flow in your installed DSH version.

See [`docs/INSTALL.md`](docs/INSTALL.md) for details, including the CLI `web` profile.

### Models

After signing in, the provider appears as **Google Antigravity** in the model picker, exposing request ids such as:

- `gemini-3.8-flash-high`, `gemini-3.7-flash-medium`, `gemini-3.1-pro-high`, …
- `claude-sonnet-4-6`, `claude-opus-4-6-thinking`
- `gpt-oss-120b-medium`

The exact list shown to you is whatever your account is authorized for.

## How it works

DeepSeek Harness lets plugins register custom LLM providers through its `llm` service. This plugin registers a **pi-ai adapter** whose transport is Google's Cloud Code Assist API, plus an OAuth login flow stored in the Harness credential store. The account pool lives in a plugin-owned file, and the active account is mirrored into the credential service.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module layout and data flow.

## Configuration

The plugin works with defaults. Advanced options (set in your profile's plugin config) are credential **references**, never secret values:

| Key | Default | Purpose |
| --- | --- | --- |
| `oauthCredentialEnv` | `GOOGLE_ANTIGRAVITY_OAUTH_CREDENTIAL` | Credential reference that mirrors the active account. |
| `oauthClientConfigRef` | `GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_CONFIG` | Optional override: a JSON `{ clientId, clientSecret }` stored here replaces the embedded Google client. |
| `displayName` | `Google Antigravity` | Provider display name. |
| `streamIdleTimeoutMs` | `300000` | Idle timeout for a streaming response. |
| `maxRequestImageBytes` / `requestImagePixelBudget` / `requestImageMaxBytes` | see defaults | Image request budgets. |

Account tokens are stored only on this device, under `$DSH_HOME/dsh-agy/accounts.json` (default `~/.dsh/dsh-agy/`), with `0600` permissions.

## Security notes

- Tokens never leave your machine except to call Google's endpoints.
- The settings RPC is gated by the Harness trust boundary (`connection.requestRejection`) and never returns token values — only account metadata and login state.
- The embedded Google client is public application identity (as shipped in the Antigravity IDE). A deployment can override it via the `oauthClientConfigRef` credential.

## Development

```bash
npm install            # legacy-peer-deps via .npmrc; @deepseek-ai/* are host-provided
npm run typecheck      # tsc --noEmit for host + client
npm test               # vitest unit tests (pure logic: auth, rotation, models, transport, storage)
npm run build          # esbuild -> lib/index.js (ESM) + lib/client.js (wrapped client bundle)
npm run smoke          # structural check that lib/ is loadable by the Harness
```

`lib/` is committed so end users install with zero build. Re-run `npm run build && npm run smoke` after changing `src/`.

## Limitations & risks

- **Internal API**: relies on Google's `v1internal` Cloud Code Assist endpoints, which can change without notice.
- **Embedded client**: Google may rotate or revoke the embedded OAuth client; set the `oauthClientConfigRef` override if that happens.
- **Model-callable tools**: `antigravity_quota`, `antigravity_stats` and `google_search` are registered with the official DSH `tools` service. Quota and runtime activity also appear in the settings UI. Search has an authenticated RPC (`POST /_dsh/dsh-agy/search`). Tool visibility depends on the agent's tool policy and the host presentation mode.
- **Version drift**: the plugin builds against the Harness `@deepseek-ai/*` API surface used by the reference plugins; if your DSH version changes those shapes, update `types/dsh-modules.d.ts` and re-run `npm run typecheck`.



## License

[MIT](./LICENSE)
