/**
 * dsh-agy plugin entry: registers the Google Antigravity provider with the
 * Harness LLM service, owns OAuth login/logout over RPC, and keeps the live
 * model catalog reconciled with Cloud Code Assist.
 */

import { createProvider, defaultProviderAuthContext, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import type { ApiKeyAuth, Model, Provider } from '@earendil-works/pi-ai'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { AntiGravityApi } from './models.ts'
import { createAntiGravityApi } from './api.ts'
import { createAntiGravityOAuth } from './auth.ts'
import { DEFAULT_OAUTH_CLIENT_CONFIG_REF, resolveOAuthClientConfig } from './client-config.ts'
import { ENDPOINTS } from './constants.ts'
import type { DshContext } from './dsh-context.ts'
import { AccountManager } from './manager.ts'
import { PROVIDER, fetchAvailableModels, maintainedModels } from './models.ts'
import { registerRpc } from './rpc.ts'

export const name = 'dsh-agy'
export const inject = ['llm', 'credentials']

const DEFAULT_OAUTH_CREDENTIAL_REF = 'GOOGLE_ANTIGRAVITY_OAUTH_CREDENTIAL'
const DEFAULT_DISPLAY_NAME = 'Google Antigravity'
const DEFAULT_STREAM_IDLE_MS = 300_000
const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024
const DEFAULT_IMAGE_PIXEL_BUDGET = 2048 * 2048
const DEFAULT_IMAGE_MAX_BYTES = 1024 * 1024

/** Deployment configuration: references and display options, never secret values. */
export interface Config {
  oauthCredentialEnv?: string
  oauthClientConfigRef?: string
  displayName?: string
  streamIdleTimeoutMs?: number
  maxRequestImageBytes?: number
  requestImagePixelBudget?: number
  requestImageMaxBytes?: number
}

export const Config = z.object({
  oauthCredentialEnv: z.string().role('credential-ref').default(DEFAULT_OAUTH_CREDENTIAL_REF),
  oauthClientConfigRef: z.string().role('credential-ref').default(DEFAULT_OAUTH_CLIENT_CONFIG_REF),
  displayName: z.string().default(DEFAULT_DISPLAY_NAME),
  streamIdleTimeoutMs: z.number().min(1).default(DEFAULT_STREAM_IDLE_MS),
  maxRequestImageBytes: z.number().min(1).default(DEFAULT_MAX_IMAGE_BYTES),
  requestImagePixelBudget: z.number().min(1).default(DEFAULT_IMAGE_PIXEL_BUDGET),
  requestImageMaxBytes: z.number().min(1).default(DEFAULT_IMAGE_MAX_BYTES),
})

interface ResolvedConfig {
  oauthCredentialEnv: string
  oauthClientConfigRef: string
  displayName: string
  streamIdleTimeoutMs: number
  maxRequestImageBytes: number
  requestImagePixelBudget: number
  requestImageMaxBytes: number
}

function resolveConfig(config: Config): ResolvedConfig {
  return {
    oauthCredentialEnv: config.oauthCredentialEnv ?? DEFAULT_OAUTH_CREDENTIAL_REF,
    oauthClientConfigRef: config.oauthClientConfigRef ?? DEFAULT_OAUTH_CLIENT_CONFIG_REF,
    displayName: config.displayName ?? DEFAULT_DISPLAY_NAME,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_MS,
    maxRequestImageBytes: config.maxRequestImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    requestImagePixelBudget: config.requestImagePixelBudget ?? DEFAULT_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: config.requestImageMaxBytes ?? DEFAULT_IMAGE_MAX_BYTES,
  }
}

/** Auth handler that only accepts a request-level OAuth override. */
const requestOverrideAuth: ApiKeyAuth = {
  name: 'Google Antigravity OAuth request override',
  resolve: ({ credential }) => Promise.resolve(
    credential?.key === undefined || credential.key.length === 0
      ? undefined
      : { auth: { apiKey: credential.key }, source: 'OAuth' },
  ),
}

function providerFor(manager: AccountManager, config: ResolvedConfig, models: readonly Model<AntiGravityApi>[], oauth: ReturnType<typeof createAntiGravityOAuth>): Provider {
  const resolvedModels = models.map((model) => ({ ...model, provider: PROVIDER, baseUrl: ENDPOINTS[0] }))
  return createProvider({
    id: PROVIDER,
    name: config.displayName,
    baseUrl: ENDPOINTS[0],
    auth: { apiKey: requestOverrideAuth, oauth },
    models: resolvedModels,
    api: createAntiGravityApi(manager),
  })
}

function profileFor(manager: AccountManager, config: ResolvedConfig, models: readonly Model<AntiGravityApi>[], oauth: ReturnType<typeof createAntiGravityOAuth>): ReadonlyMap<string, ResolvedPiAiProviderProfile> {
  return new Map([[PROVIDER, {
    provider: PROVIDER,
    displayName: config.displayName,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    maxRequestImageBytes: config.maxRequestImageBytes,
    requestImagePixelBudget: config.requestImagePixelBudget,
    requestImageMaxBytes: config.requestImageMaxBytes,
    retryPolicy: resolveRetryPolicy(undefined, 'dsh-agy: retryPolicy'),
    configuredMaxTokens: new Map(),
    piProvider: providerFor(manager, config, models, oauth),
  }]])
}

/**
 * Register Antigravity inference, OAuth RPC, and the maintained/live catalog.
 * @param ctx - Harness context providing the LLM and credential services.
 * @param rawConfig - validated plugin configuration.
 */
export function apply(ctx: DshContext, rawConfig: Config): void {
  const config = resolveConfig(rawConfig)
  const oauth = createAntiGravityOAuth(() =>
    resolveOAuthClientConfig(ctx.credentials, config.oauthClientConfigRef))
  const manager = new AccountManager({
    oauth,
    credentials: ctx.credentials,
    credentialRef: credentialRef(config.oauthCredentialEnv),
    clientConfigRef: config.oauthClientConfigRef,
  })
  void manager.init()

  let profiles = profileFor(manager, config, maintainedModels, oauth)
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: () => manager.resolveApiKey(),
    auth: { credentials: new InMemoryCredentialStore(), authContext: defaultProviderAuthContext() },
    resolveAttachments: () => ctx.get('attachments'),
  })
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)

  // Live catalog reconciliation against fetchAvailableModels.
  const controller = new AbortController()
  let refreshing: Promise<void> | undefined
  const refresh = (): void => {
    refreshing ??= (async () => {
      try {
        const auth = await manager.resolveAuth()
        const live = await fetchAvailableModels(auth.token, auth.projectId, controller.signal)
        profiles = profileFor(manager, config, live, oauth)
        registration.replace([PROVIDER])
      } catch (error) {
        if (!controller.signal.aborted) {
          ctx.logger.info('dsh-agy: live model refresh unavailable; keeping the maintained catalog')
          ctx.logger.debug(error)
        }
      } finally {
        refreshing = undefined
      }
    })()
  }
  ctx.effect(() => {
    const timers = [setTimeout(refresh, 0), setTimeout(refresh, 250)]
    return () => {
      for (const timer of timers) clearTimeout(timer)
      controller.abort()
    }
  }, 'dsh-agy: live refresh')

  ctx.on('credentials/reference-updated', ((ref: string) => {
    if (ref === config.oauthCredentialEnv) refresh()
  }) as never)

  // Register RPC once the web server and connection gate are available.
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    const dispose = registerRpc(webCtx.webServer, webCtx.connection, manager)
    webCtx.effect(() => dispose, 'dsh-agy: rpc')
  })
}

export { PROVIDER }
