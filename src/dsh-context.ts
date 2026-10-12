/**
 * Minimal local contracts for the DeepSeek Harness host services this plugin
 * consumes. The real objects are provided by the Harness runtime at load time;
 * these interfaces only describe the exact surface the plugin calls, so the
 * code typechecks without the (unpublished) Harness packages.
 *
 * Field names and call shapes mirror the reference plugins:
 *   - provider registration / credentials: OpenSaozi/dsh-antigravity
 *   - HTTP RPC over webServer + connection: SONGOAO25/dsh-chatgpt-sub
 */

import type { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Registration handle returned by the LLM service; `replace` refreshes the catalog. */
export interface LlmRegistration {
  (): void
  replace(providers: string[]): void
}

/** Harness LLM service used to register a provider adapter. */
export interface LlmService {
  registerAdapter(providers: string[], adapter: PiAiAdapter): LlmRegistration
}

/** Structured host logger. */
export interface DshLogger {
  info(message: unknown, ...rest: unknown[]): void
  debug(message: unknown, ...rest: unknown[]): void
  warn(message: unknown, ...rest: unknown[]): void
  error(message: unknown, ...rest: unknown[]): void
}

/** Handle returned by `ctx.effect` to register a cleanup callback. */
export type EffectCleanup = () => void | Promise<void>

/**
 * HTTP request/response pair compatible with Node's `http` module, narrowed to
 * what the RPC handler touches.
 */
export interface HttpLikeRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
}
export interface HttpLikeResponse {
  writeHead(status: number, headers?: Record<string, string>): HttpLikeResponse
  end(chunk?: string): void
}

/** Harness web server used to expose JSON RPC routes to the settings page. */
export interface WebServerService {
  register(options: {
    kind: 'prefix'
    path: string
    handler: (req: HttpLikeRequest, res: HttpLikeResponse) => void | Promise<void>
  }): () => void
}

/** Harness connection service providing the auth / anti-rebinding gate. */
export interface ConnectionService {
  /** Returns a rejection payload when the request is not allowed, else `undefined`. */
  requestRejection(req: HttpLikeRequest): unknown
}

/** Context handed to an `inject` callback once the named services are ready. */
export interface WebRpcContext {
  webServer: WebServerService
  connection: ConnectionService
  effect<T>(fn: () => T | EffectCleanup, key?: string): T
}

/** The host context handed to `apply(ctx, config)`. */
export interface DshContext {
  tools: { register<Args, Value>(definition: ToolDefinition<Args, Value>): () => void }
  llm: LlmService
  credentials: CredentialProvider
  logger: DshLogger
  /** Run `fn`, registering its returned cleanup for disposal with the plugin. */
  effect<T>(fn: () => T | EffectCleanup, key?: string): T
  /** Subscribe to a host event; returns an unsubscribe handle when available. */
  on(event: string, handler: (...args: never[]) => void): unknown
  /** Resolve another service by name (e.g. attachments). */
  get<T = unknown>(name: string): T | undefined
  /** Defer work until the named services exist, then run `fn` with them ready. */
  inject<T>(names: string[], fn: (ctx: WebRpcContext) => T): T
}
