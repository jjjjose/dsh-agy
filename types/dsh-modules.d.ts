/**
 * Development-only type shims for DeepSeek Harness packages that are not
 * resolvable from the public npm registry (their RCs reference unpublished
 * workspace peers such as `@deepseek-ai/dsh-environment`).
 *
 * At runtime the Harness host provides the real implementations; this plugin
 * marks every `@deepseek-ai/*` package external in its build so the host's
 * instances are used. These declarations only let `tsc` typecheck the plugin
 * against the exact API surface it consumes, which mirrors the usage in the
 * reference plugin `OpenSaozi/dsh-sh-antigravity`.
 *
 * If your Harness version changes one of these shapes, update the shim to
 * match and re-run `npm run typecheck`.
 */

declare module '@deepseek-ai/dsh-credentials' {
  /** Opaque credential reference name (e.g. GOOGLE_ANTIGRAVITY_OAUTH_CREDENTIAL). */
  export type CredentialRef = string & { readonly __dshCredentialRef?: unique symbol }
  /** Narrow a plain string into a credential reference. */
  export function credentialRef(value: string): CredentialRef
  /** Metadata describing a stored credential without exposing its value. */
  export interface CredentialInfo {
    configured: boolean
    source?: string
  }
  /** Harness credential store service. */
  export interface CredentialProvider {
    resolve(ref: CredentialRef): Promise<{ value: string; source?: string } | undefined>
    set(ref: CredentialRef, value: string): Promise<void>
    unset(ref: CredentialRef): Promise<void>
    describe(ref: CredentialRef): Promise<CredentialInfo>
  }
}

declare module '@deepseek-ai/dsh-llm' {
  /** Error surfaced by the Harness LLM layer with a stable machine code. */
  export type LlmErrorCode = 'AUTH' | 'MISSING_CREDENTIAL' | 'PROTOCOL' | (string & {})
  export class LlmError extends Error {
    constructor(message: string, code: LlmErrorCode, options?: { cause?: unknown })
    readonly code: LlmErrorCode
  }
  /** Assert an API key is non-empty and usable, throwing `LlmError` otherwise. */
  export function assertUsableApiKey(key: string, plugin: string, ref: string): string
  /** Provider retry policy resolved from plugin configuration. */
  export interface RetryPolicy {
    retries?: number
    minTimeout?: number
    maxTimeout?: number
  }
  export function resolveRetryPolicy(value: unknown, name: string): RetryPolicy
}

declare module '@deepseek-ai/dsh-llm-pi-ai' {
  import type { Api, Provider } from '@earendil-works/pi-ai'
  /** Per-provider runtime profile consumed by the generic pi-ai adapter. */
  export interface ResolvedPiAiProviderProfile {
    provider: string
    displayName: string
    streamIdleTimeoutMs: number
    maxRequestImageBytes: number
    requestImagePixelBudget: number
    requestImageMaxBytes: number
    retryPolicy: unknown
    configuredMaxTokens: Map<string, number>
    piProvider: Provider<Api>
    modelErrors: ReadonlyMap<string, string>
  }
  interface PiAiAdapterOptions {
    profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>
    resolveApiKey: () => Promise<string>
    auth: {
      credentials: unknown
      authContext: unknown
    }
    resolveAttachments?: () => unknown
  }
  /** Generic adapter bridging a pi-ai provider to the Harness LLM service. */
  export class PiAiAdapter {
    constructor(options: PiAiAdapterOptions)
    listModels(provider: string): Promise<Array<{ provider: string; id: string; name: string; inputModalities: string[] }>>
  }
}

declare module '@deepseek-ai/dsh-tools' {
  export interface ToolDefinition<Args, Value> {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: {
      schema: Record<string, unknown>
      render(args: Args, value: Value): Array<{ type: 'text'; text: string }>
    }
    execute(args: Args, context: { signal: AbortSignal }): Promise<Value>
  }
  export function defineTool<Args, Value>(definition: ToolDefinition<Args, Value>): ToolDefinition<Args, Value>
}
