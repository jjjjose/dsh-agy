# Architecture

`dsh-agy` is a DeepSeek Harness (Cordis) plugin with two halves:

- **Host** (`src/*.ts` → `lib/index.js`, ESM): registers the `google-antigravity` provider with the Harness `llm` service, owns OAuth login and the multi-account pool, and serves an HTTP RPC for the settings page.
- **Client** (`src/client/index.tsx` → `lib/client.js`): a React settings page bundled as a classic script and wrapped in `window.__ModuleLoader__.load({ id, factory })`. It talks to the host over the RPC. The settings slot key and loader id both equal `dsh-agy`, following `dsh-chatgpt-sub`.

At runtime the host provides the `@deepseek-ai/*` packages and `@earendil-works/pi-ai`; the build marks them **external** so the host's instances are used (important for `instanceof` checks inside `PiAiAdapter`).

## Data flow (a chat request)

```
model picker
   └─> Harness llm service ── AntigravityAdapter / PiAiAdapter (profiles: google-antigravity)
          └─> createProvider(...).stream(model, context, options)
                 └─> createAntiGravityApi(manager).stream(...)
                         ├─ manager.acquireRequest() → FIFO admission + compatible account + token refresh
                         ├─ catalog.resolve(account, model, effort) → validate the real account's capabilities
                        ├─ buildEnvelope(...)       → { project, model, request, requestType, ... }
                        ├─ POST v1internal:streamGenerateContent?alt=sse
                        ├─ SSE → assistant events (text / thinking / toolCall), signatures kept
                         └─ on 429 → manager.reportRateLimit → terminal error → DSH retry selects an eligible account
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
| `models.ts` | Dynamic `fetchAvailableModels` parsing, identity grouping, effort routes and hidden legacy aliases. |
| `model-adapter.ts` | Filters legacy aliases from the picker while retaining internal ID resolution through the host adapter. |
| `catalog.ts` | Per-account/project discovery, 15-minute freshness, 24-hour sanitized disk fallback, invalidation and route validation. |
| `catalog-controller.ts` | Startup/periodic/manual/account-change refresh, revision guards and lifecycle cleanup. |
| `api.ts` | Cloud Code Assist envelope + SSE stream → pi-ai events; one HTTP inference attempt per call. |
| `quota.ts` | Fetch/format dual-window quota. |
| `search.ts` | Grounding-only Google Search, shared by the native tool and RPC. |
| `tools.ts` | Native DSH tool registration, canonical JSON output and model-visible rendering. |
| `rpc.ts` | HTTP JSON RPC over `webServer` + `connection` trust boundary. |
| `stats.ts` | Token-free, in-memory request activity for this plugin instance. |
| `index.ts` | `apply()`: wires the adapter, provider, live catalog refresh, and RPC. |
| `client/index.tsx` | Settings page (sign in, accounts, quota). |

## Multi-account rotation

`AccountManager` selects the account for each request:

1. Filter to **enabled** accounts that are not **rate-limited**, not **cooling down**, and healthy enough.
2. Score by health (2×), token balance (5×), and rest recency (0.1×); the active account keeps a **stickiness** bonus so it only switches when another is clearly better.
3. Refresh the chosen account's access token if near expiry.
4. Classify failures before rotating: authorization errors are not automatically quota errors. A failed inference returns to DSH; its next attempt selects an eligible account and rebuilds the envelope with that account's project. Inference does not retry HTTP requests or endpoints internally; catalog discovery still has endpoint fallback.
5. Validate the selected model/effort for the sending account. Skip incompatible alternative accounts without changing the model or effort. Capability mismatch is not a quota penalty.

Health starts at 70, recovers +2/hour, drops on general failures (−20), and gates selection below 50. Rate limits only set their retry window: simultaneous 429 responses do not reduce health or trigger a second general-error penalty. A client-side token bucket smooths bursts; reservation happens synchronously before token refresh yields.

The transport acquires a FIFO admission slot (default four simultaneous streams per plugin instance), validates account/model/effort eligibility, and authenticates under the caller's cancellation signal. Initial queue/auth/budget wait is bounded by `requestQueueTimeoutMs` (default 60 seconds); active streams retain the host watchdog. Slots release in `finally`, including conversion failures and cancellation. Shared OAuth refresh continues when just one caller cancels. Manager disposal cancels active transport signals and queued requests. The host credential resolver returns a non-secret managed-auth marker; the actual credential is acquired only inside the transport.

## Dynamic model catalog

The transport targets pi-ai 1.x (validated with 1.0.2). `Models.streamSimple()` calls `normalizeContext()` before invoking a provider: tools and prompt are moved from the request-level `Context` to transcript system messages. `api.ts` resolves `getCurrentTools()` and `getCurrentSystemPrompt()` before building declarations and systemInstruction; these utilities apply removals, additions and section updates in order. Direct calls with legacy Context fields are normalized too. The adapter never changes deferred-tool admission. `inference-scope.ts` correlates the frozen host call and its lazy stream with AsyncLocalStorage; no correlation headers or conversational data are sent.

Antigravity's live catalog uses `maxTokens` for input/context and `maxOutputTokens` for output. Limits and image/video flags are retained per wire route; the grouped descriptor uses the smallest known limits, ignoring missing values rather than letting a fallback downgrade confirmed capabilities. When a route is selected, inference uses its limits and rejects output requests above them. Unknown capabilities are marked explicitly; operational defaults are not confirmed limits. The host's single grouped model descriptor cannot advertise a different window for each effort, so differing route windows are shown in the plugin page.

Cache v2 stores sanitized per-route capabilities, provenance, original verification timestamps and aliases. Cache v1 is not trusted because it persisted synthetic limits without provenance. A same-route limit omitted by a later discovery may reuse a still-fresh confirmed value, but repeated catalog refreshes do not extend its 24-hour verification lifetime. No separate per-model metadata endpoint was required by the observed catalog.

Google's model IDs remain the wire identities. The picker uses a canonical version/family identity and explicitly mapped effort routes, not grouping by display name alone. The known `gemini-3-flash-agent` alias maps to Gemini 3.5 Flash's Medium/High routes. New compatible version IDs require no hardcoded version list.

DSH reads the model's `thinkingLevelMap` and passes its validated effort to `streamSimple` as `options.reasoning`, except Off, which the host deliberately omits. Consequently, models offering Off also use their Off route as the provider default. Both transport entry points resolve effort before building the envelope. Claude's thinking routes use budgets capped below the output limit; Gemini tier routes carry their selected thinking level.

`catalog-controller.ts` uses revision checks so late account-selection work cannot replace the current account's catalog. `catalog.ts` deduplicates discovery by account/project, bounds requests to 30 seconds, and cancels on disposal. Profiles are replaced only when the visible model snapshot changes; prepared DSH calls retain their own snapshot. Retired models are removed even if Google returns a valid empty catalog.

Cache files under `$DSH_HOME/dsh-agy/model-catalogs/<sha256>.json` contain only reconstructed model metadata. Freshness is 15 minutes and network fallback expires after 24 hours. Cache load is validated; discovery HTTP 401/403 and removed/revoked accounts invalidate the corresponding entries. No static model list is shown if both discovery and cache are unavailable.

## Trust boundary & storage

- The RPC registers via `webServer.register({ kind: 'prefix', path: '/_dsh/dsh-agy' })` and gates every request with `connection.requestRejection(req)`. GET serves reads (`status`, `poll`, `quota`, `stats`, `models/status`, `diagnostics`); POST is required for actions (`login`, `logout`, `activate`, `refresh-models`, `search`, diagnostic configuration/clear). Manual model refresh awaits completion and returns catalog status. JSON responses use `Cache-Control: no-store`. Responses never include token values.
- Account tokens live only in `$DSH_HOME/dsh-agy/accounts.json` (`0600`), validated on load and written atomically. The active account is additionally mirrored into the credential reference `GOOGLE_ANTIGRAVITY_OAUTH_CREDENTIAL`.

## Build

`scripts/build.mjs` (esbuild):

- **Host** → `lib/index.js`, ESM, Node target, externals: `@deepseek-ai/*`, `@earendil-works/pi-ai*`, `react`.
- **Client** → CJS (classic JSX, `require('react')`), wrapped in the `__ModuleLoader__` factory → `lib/client.js`.

`scripts/smoke.mjs` asserts the built artifacts keep the host packages external and expose the expected plugin shape (`name`, `inject`, `apply`, `Config`).

## Harness API shims

The `@deepseek-ai/dsh-*` packages are not installable from the public registry (unpublished workspace peers). `types/dsh-modules.d.ts` declares the exact surface this plugin consumes (`credentialRef`, `LlmError`, `resolveRetryPolicy`, `PiAiAdapter`, …), mirroring the reference plugins. `src/dsh-context.ts` describes the host services (`llm`, `credentials`, `webServer`, `connection`) locally. If your DSH version changes these shapes, update the shims and re-run `npm run typecheck`.

## Validation boundary

Unit tests and bundle checks do not prove compatibility with an installed DSH host. A release must also verify plugin loading, the settings button, Google authorization, model discovery, multi-turn tool execution, cancellation and persistence after restart in Desktop/Web. Never use real credentials in automated fixtures. The plugin does not modify other providers, agent defaults or the selected search provider.
