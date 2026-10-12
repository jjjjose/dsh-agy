# Architecture

`dsh-agy` is a DeepSeek Harness (Cordis) plugin with two halves:

- **Host** (`src/*.ts` → `lib/index.js`, ESM): registers the `google-antigravity` provider with the Harness `llm` service, owns OAuth login and the multi-account pool, and serves an HTTP RPC for the settings page.
- **Client** (`src/client/index.tsx` → `lib/client.js`): a React settings page bundled as a classic script and wrapped in `window.__ModuleLoader__.load({ id, factory })`. It talks to the host over the RPC.

At runtime the host provides the `@deepseek-ai/*` packages and `@earendil-works/pi-ai`; the build marks them **external** so the host's instances are used (important for `instanceof` checks inside `PiAiAdapter`).

## Data flow (a chat request)

```
model picker
   └─> Harness llm service ── PiAiAdapter (profiles: google-antigravity)
          └─> createProvider(...).stream(model, context, options)
                 └─> createAntiGravityApi(manager).stream(...)
                        ├─ manager.resolveApiKey()  → rotation + token refresh → RequestAuth JSON
                        ├─ buildEnvelope(...)       → { project, model, request, requestType, ... }
                        ├─ POST v1internal:streamGenerateContent?alt=sse
                        ├─ SSE → assistant events (text / thinking / toolCall), signatures kept
                        └─ on 429 → manager.reportRateLimit + afterRateLimit → retry next account
```

## Modules

| File | Responsibility |
| --- | --- |
| `constants.ts` | Embedded OAuth client, scopes, endpoints, shared request headers. |
| `client-config.ts` | Resolve the OAuth client: credential override, else embedded. |
| `auth.ts` | PKCE login (localhost callback), token exchange, project discovery; pi-ai `OAuthAuth`. |
| `token.ts` | Refresh one account's access token; classify `invalid_grant` as revoked. |
| `types.ts` | Shared types (accounts, credential, quota, envelope). |
| `storage.ts` | Persistent account pool (`$DSH_HOME/dsh-agy/accounts.json`), atomic writes, in-process lock. |
| `rotation.ts` | Health tracker, token bucket, rate-limit/cooldown checks, sticky account selection. |
| `manager.ts` | Orchestrates pool + rotation + refresh; implements the auth source for the transport; mirrors the active account into the credential store. |
| `models.ts` | Maintained catalog + `fetchAvailableModels` reconciliation. |
| `api.ts` | Cloud Code Assist envelope + SSE stream → pi-ai events; rotation-aware retry. |
| `quota.ts` | Fetch/format dual-window quota. |
| `search.ts` | Grounding-only Google Search (module; not yet a model-callable tool). |
| `rpc.ts` | HTTP JSON RPC over `webServer` + `connection` trust boundary. |
| `index.ts` | `apply()`: wires the adapter, provider, live catalog refresh, and RPC. |
| `client/index.tsx` | Settings page (sign in, accounts, quota). |

## Multi-account rotation

`AccountManager` selects the account for each request:

1. Filter to **enabled** accounts that are not **rate-limited**, not **cooling down**, and healthy enough.
2. Score by health (2×), token balance (5×), and rest recency (0.1×); the active account keeps a **stickiness** bonus so it only switches when another is clearly better.
3. Refresh the chosen account's access token if near expiry.
4. On a 429/403, mark that account rate-limited (30 min) and retry once with the next usable account.

Health starts at 70, recovers +2/hour, drops on rate limits (−10) and failures (−20), and gates selection below 50. A client-side token bucket smooths bursts.

## Trust boundary & storage

- The RPC registers via `webServer.register({ kind: 'prefix', path: '/_dsh/dsh-agy' })` and gates every request with `connection.requestRejection(req)`. GET serves reads (`status`, `poll`, `quota`); POST is required for mutations (`login`, `logout`, `activate`). Responses never include token values.
- Account tokens live only in `$DSH_HOME/dsh-agy/accounts.json` (`0600`), validated on load and written atomically. The active account is additionally mirrored into the credential reference `GOOGLE_ANTIGRAVITY_OAUTH_CREDENTIAL`.

## Build

`scripts/build.mjs` (esbuild):

- **Host** → `lib/index.js`, ESM, Node target, externals: `@deepseek-ai/*`, `@earendil-works/pi-ai*`, `react`.
- **Client** → CJS (classic JSX, `require('react')`), wrapped in the `__ModuleLoader__` factory → `lib/client.js`.

`scripts/smoke.mjs` asserts the built artifacts keep the host packages external and expose the expected plugin shape (`name`, `inject`, `apply`, `Config`).

## Harness API shims

The `@deepseek-ai/dsh-*` packages are not installable from the public registry (unpublished workspace peers). `types/dsh-modules.d.ts` declares the exact surface this plugin consumes (`credentialRef`, `LlmError`, `resolveRetryPolicy`, `PiAiAdapter`, …), mirroring the reference plugins. `src/dsh-context.ts` describes the host services (`llm`, `credentials`, `webServer`, `connection`) locally. If your DSH version changes these shapes, update the shims and re-run `npm run typecheck`.
