/**
 * dsh-agy plugin entry: registers the Google Antigravity provider with the
 * Harness LLM service, owns OAuth login/logout over RPC, and keeps the live
 * model catalog reconciled with Cloud Code Assist.
 */

import { createProvider, defaultProviderAuthContext, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import type { ApiKeyAuth, Model, Provider, SimpleStreamOptions } from '@earendil-works/pi-ai'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { AntigravityAdapter } from './model-adapter.ts'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { AntiGravityApi, DynamicModel } from './models.ts'
import { createAntiGravityApi } from './api.ts'
import { createAntiGravityOAuth } from './auth.ts'
import { DEFAULT_OAUTH_CLIENT_CONFIG_REF, resolveOAuthClientConfig } from './client-config.ts'
import { ENDPOINTS } from './constants.ts'
import type { DshContext, LlmRegistration } from './dsh-context.ts'
import { AccountManager } from './manager.ts'
import { ModelSelectionError, PROVIDER, selectedModelEffort, withLegacyAliases } from './models.ts'
import { registerRpc } from './rpc.ts'
import { EngineStats } from './stats.ts'
import { Diagnostics } from './diagnostics.ts'
import { ModelCatalog } from './catalog.ts'
import { CatalogController } from './catalog-controller.ts'
import { registerTools } from './tools.ts'
import { createSelfUpdater, DEFAULT_UPDATE_INTERVAL_MS } from './self-update.ts'

export const name = 'dsh-agy'
export const inject = ['llm', 'credentials', 'tools']

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
  autoUpdateEnabled?: boolean
  autoUpdateIntervalMs?: number
  updateRegistryOrigin?: string
}

export const Config = z.object({
  oauthCredentialEnv: z.string().role('credential-ref').default(DEFAULT_OAUTH_CREDENTIAL_REF),
  oauthClientConfigRef: z.string().role('credential-ref').default(DEFAULT_OAUTH_CLIENT_CONFIG_REF),
  displayName: z.string().default(DEFAULT_DISPLAY_NAME),
  streamIdleTimeoutMs: z.number().min(1).default(DEFAULT_STREAM_IDLE_MS),
  maxRequestImageBytes: z.number().min(1).default(DEFAULT_MAX_IMAGE_BYTES),
  requestImagePixelBudget: z.number().min(1).default(DEFAULT_IMAGE_PIXEL_BUDGET),
  requestImageMaxBytes: z.number().min(1).default(DEFAULT_IMAGE_MAX_BYTES),
  autoUpdateEnabled: z.boolean().default(false),
  autoUpdateIntervalMs: z.number().min(60000).max(604800000).default(DEFAULT_UPDATE_INTERVAL_MS),
  updateRegistryOrigin: z.string().default(''),
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
    modelErrors: new Map(),
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
  const updater = createSelfUpdater({ config: {
    enabled: rawConfig.autoUpdateEnabled ?? false,
    intervalMs: rawConfig.autoUpdateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS,
    registryOrigin: rawConfig.updateRegistryOrigin ?? '',
  } })
  ctx.effect(() => { updater.start(); return () => updater.dispose() }, 'dsh-agy: package self-update')
  const oauth = createAntiGravityOAuth(() =>
    resolveOAuthClientConfig(ctx.credentials, config.oauthClientConfigRef))
  const manager = new AccountManager({
    oauth,
    credentials: ctx.credentials,
    credentialRef: credentialRef(config.oauthCredentialEnv),
    clientConfigRef: config.oauthClientConfigRef,
  })
  const stats = new EngineStats()
  const diagnostics = new Diagnostics(updater.status().runningVersion)
  manager.reportLog = (entry) => diagnostics.record(entry)
  manager.reportDiagnostic = (diagnostic) => stats.diagnostic(diagnostic)
  const reportSuccess = manager.reportSuccess.bind(manager)
  manager.reportSuccess = (accountId) => {
    stats.record(accountId, 'success')
    reportSuccess(accountId)
  }
  const reportRateLimit = manager.reportRateLimit.bind(manager)
  manager.reportRateLimit = (accountId, ...args) => {
    stats.record(accountId, 'rateLimits')
    reportRateLimit(accountId, ...args)
  }
  const reportError = manager.reportError.bind(manager)
  manager.reportError = (accountId) => {
    stats.record(accountId, 'errors')
    reportError(accountId)
  }
  void manager.init().catch(() => ctx.logger.warn('dsh-agy: account storage could not be initialized'))

  let profiles = profileFor(manager, config, [], oauth)
  let registration: LlmRegistration | undefined
  let publishedModels: readonly DynamicModel[] | undefined
  const catalog = new ModelCatalog({ log: (entry) => diagnostics.record(entry), changed: () => {
    const models = catalog.models()
    if (models === publishedModels) return
    publishedModels = models
    profiles = profileFor(manager, config, withLegacyAliases(models), oauth)
    registration?.replace([PROVIDER])
  } })
  manager.resolveModel = async (model, options, auth, signal) => {
    const identities = await manager.catalogIdentities()
    if (!identities.some((identity) => identity.accountId === auth.accountId && identity.projectId === auth.projectId)) throw new ModelSelectionError('Antigravity sending account is unavailable')
    return catalog.resolve(auth, model.id, selectedModelEffort(model, (options as SimpleStreamOptions).reasoning), signal)
  }
  const catalogController = new CatalogController(catalog, manager)
  manager.accountsChanged = () => { void catalogController.refresh() }
  const adapter = new AntigravityAdapter({
    profiles: () => profiles,
    resolveApiKey: () => manager.resolveApiKey(),
    auth: { credentials: new InMemoryCredentialStore(), authContext: defaultProviderAuthContext() },
    resolveAttachments: () => ctx.get('attachments'),
  }, () => new Set(catalog.models().map((model) => model.id)), (entry) => diagnostics.record(entry))
  registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  ctx.effect(() => () => registration?.(), 'dsh-agy: provider registration')
  ctx.effect(() => () => manager.dispose(), 'dsh-agy: account manager')
  ctx.effect(() => registerTools(ctx.tools, manager, stats), 'dsh-agy: agent tools')

  const refresh = () => catalogController.refresh()
  ctx.effect(() => {
    catalogController.start()
    return () => catalogController.dispose()
  }, 'dsh-agy: live refresh')

  ctx.on('credentials/reference-updated', ((ref: string) => {
    if (ref === config.oauthCredentialEnv) void refresh()
  }) as never)
  // RC hosts used the earlier event name; catalog refresh is deduplicated.
  ctx.on('credentials/updated', ((ref: string) => {
    if (ref === config.oauthCredentialEnv) void refresh()
  }) as never)

  // Register RPC once the web server and connection gate are available.
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    const dispose = registerRpc(webCtx.webServer, webCtx.connection, manager, { refreshModels: refresh, stats, updater, diagnostics, catalog })
    webCtx.effect(() => dispose, 'dsh-agy: rpc')
  })
}

export { PROVIDER }

// Match the package-plugin contract used by dsh-chatgpt-sub while preserving
// named Cordis exports for hosts that load the namespace directly.
export default { name, inject, Config, apply }
