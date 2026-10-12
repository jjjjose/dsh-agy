/**
 * Account manager: owns the persistent pool, selects accounts with rotation,
 * refreshes access tokens on demand, mirrors the active account into the
 * Harness credential store, and supplies the rotation-aware auth used by the
 * streaming transport.
 */

import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import { DEFAULT_OAUTH_CLIENT_CONFIG_REF, resolveOAuthClientConfig, type OAuthClientConfig } from './client-config.ts'
import { refreshAccountAccess } from './token.ts'
import { HealthTracker, TokenBucket, isCoolingDown, isRateLimited, selectAccount } from './rotation.ts'
import { clearPool, loadPool, savePool } from './storage.ts'
import type { RequestAuth } from './api.ts'
import type { Account, LoginId, LoginStatus } from './types.ts'

const RATE_LIMIT_WINDOW_MS = 30 * 60_000
const COOLDOWN_MS = 60_000

interface LoginAttempt {
  id: LoginId
  controller: AbortController
  status: LoginStatus
}

/** Snapshot of one account safe for browser display. */
export interface AccountView {
  id: string
  email?: string
  enabled: boolean
  active: boolean
  rateLimited: boolean
  coolingDown: boolean
}

export interface ManagerOptions {
  oauth: OAuthAuth
  credentials: CredentialProvider
  credentialRef: CredentialRef
  clientConfigRef?: string
  /** Maximum wait for a short account cooldown; defaults to 1s, capped at 5s. */
  maxWaitMs?: number
}

/** Interaction bridge reused from pi-ai's login contract. */
export interface LoginInteraction {
  signal?: AbortSignal
  notify(event: { type: string; url?: string; instructions?: string }): void
  prompt(prompt: unknown): Promise<string>
}

export class AccountManager {
  private accounts: Account[] = []
  private activeId?: string
  private loaded = false
  private initialization?: Promise<void>
  private disposed = false
  private readonly lifetime = new AbortController()
  private readonly refreshes = new Map<string, Promise<string>>()
  private readonly health = new HealthTracker()
  private readonly bucket = new TokenBucket()
  private attempt: LoginAttempt | undefined

  constructor(private readonly options: ManagerOptions) {}

  /** Load the pool from disk (idempotent). */
  async init(): Promise<void> {
    if (this.disposed) throw new Error('Antigravity manager was disposed')
    if (this.loaded) return
    this.initialization ??= loadPool().then((pool) => {
      this.accounts = pool.accounts
      this.activeId = pool.activeId
      this.loaded = true
    }).catch((error: unknown) => { this.initialization = undefined; throw error })
    await this.initialization
    if (this.disposed) throw new Error('Antigravity manager was disposed')
  }

  private async clientConfig(): Promise<OAuthClientConfig> {
    return resolveOAuthClientConfig(this.options.credentials, this.options.clientConfigRef ?? DEFAULT_OAUTH_CLIENT_CONFIG_REF)
  }

  private async persist(): Promise<void> {
    await savePool({
      version: 1,
      accounts: this.accounts,
      ...this.activeId === undefined ? {} : { activeId: this.activeId },
    })
  }

  /** Read-only account views for display. */
  async list(): Promise<AccountView[]> {
    await this.init()
    const now = Date.now()
    return this.accounts.map((a) => ({
      id: a.id,
      email: a.email,
      enabled: a.enabled,
      active: a.id === this.activeId,
      rateLimited: isRateLimited(a, now),
      coolingDown: isCoolingDown(a, now),
    }))
  }

  /** Whether any account is configured. */
  async hasAccounts(): Promise<boolean> {
    await this.init()
    return this.accounts.length > 0
  }

  /** Ambient access for every account (refreshing as needed), for quota display. */
  async quotaAccounts(): Promise<Array<{ id: string; email?: string; enabled: boolean; projectId: string; access: string }>> {
    await this.init()
    const out: Array<{ id: string; email?: string; enabled: boolean; projectId: string; access: string }> = []
    for (const account of this.accounts) {
      if (!account.enabled) {
        out.push({ id: account.id, email: account.email, enabled: false, projectId: account.projectId, access: '' })
        continue
      }
      try {
        out.push({ id: account.id, email: account.email, enabled: true, projectId: account.projectId, access: await this.ensureAccess(account) })
      } catch {
        out.push({ id: account.id, email: account.email, enabled: account.enabled, projectId: account.projectId, access: '' })
      }
    }
    return out
  }

  // ---- Login / logout -----------------------------------------------------

  /** Start one OAuth login; the browser opens `authorizationUrl`. */
  async startLogin(): Promise<{ loginId: LoginId; authorizationUrl: string }> {
    await this.init()
    this.cancelLogin()
    const attempt: LoginAttempt = { id: randomUUID(), controller: new AbortController(), status: { kind: 'pending' } }
    this.attempt = attempt
    let resolveUrl!: (value: string) => void
    let rejectUrl!: (reason: unknown) => void
    const promise = new Promise<string>((resolve, reject) => { resolveUrl = resolve; rejectUrl = reject })
    const url = { resolve: resolveUrl, reject: rejectUrl, promise }
    attempt.controller.signal.addEventListener('abort', () => url.reject(new Error('Antigravity OAuth was cancelled')), { once: true })
    const notify = (event: { type: string; url?: string }): void => {
      if (event.type === 'auth_url' && typeof event.url === 'string') url.resolve(event.url)
    }
    const piInteraction = {
      signal: attempt.controller.signal,
      notify,
      prompt: (): Promise<string> => Promise.reject(new Error('Antigravity OAuth does not support interactive prompts')),
    }
    void this.options.oauth.login(piInteraction).then(async (credential) => {
      url.reject(new Error('Antigravity OAuth completed without an authorization URL'))
      if (this.attempt !== attempt || attempt.controller.signal.aborted) return
      await this.addCredential(credential)
      if (this.attempt !== attempt || attempt.controller.signal.aborted) return
      attempt.status = { kind: 'succeeded', email: (credential as OAuthCredential & { email?: string }).email }
    }).catch((error: unknown) => {
      if (attempt.controller.signal.aborted) {
        attempt.status = { kind: 'cancelled' }
        url.reject(new Error('Antigravity OAuth was cancelled'))
        return
      }
      const message = error instanceof Error ? error.message : 'Antigravity OAuth failed'
      attempt.status = { kind: 'failed', message }
      url.reject(new Error(message))
    })
    return { loginId: attempt.id, authorizationUrl: await url.promise }
  }

  /** Poll one login attempt's status. */
  pollLogin(id: LoginId): LoginStatus {
    if (this.attempt?.id !== id) return { kind: 'failed', message: 'Antigravity login attempt is no longer active' }
    return this.attempt.status
  }

  /** Cancel the current login (or only the supplied matching attempt). */
  cancelLogin(id?: LoginId): void {
    if (!this.attempt || (id !== undefined && this.attempt.id !== id)) return
    if (this.attempt.status.kind !== 'pending') return
    this.attempt.status = { kind: 'cancelled' }
    this.attempt.controller.abort()
  }

  /** Stop login and in-flight token refreshes; the manager cannot be reused. */
  dispose(): void {
    this.cancelLogin()
    this.disposed = true
    this.lifetime.abort()
  }

  /** Remove one account, or all when `accountId` is undefined. */
  async remove(accountId?: string): Promise<void> {
    await this.init()
    if (accountId === undefined) {
      this.cancelLogin()
      this.accounts = []
      this.activeId = undefined
      await clearPool()
      await this.options.credentials.unset(this.options.credentialRef)
      return
    }
    this.accounts = this.accounts.filter((a) => a.id !== accountId)
    if (this.activeId === accountId) this.activeId = this.accounts[0]?.id
    await this.persist()
    if (this.accounts.length === 0) await this.options.credentials.unset(this.options.credentialRef)
    else await this.mirrorActive()
  }

  /** Explicitly select the active account. */
  async setActive(accountId: string): Promise<boolean> {
    await this.init()
    const account = this.accounts.find((a) => a.id === accountId)
    if (!account || !account.enabled || isRateLimited(account) || isCoolingDown(account)) return false
    this.activeId = accountId
    await this.persist()
    await this.mirrorActive()
    return true
  }

  // ---- Auth resolution ----------------------------------------------------

  /** Pick the best account, refresh its access token, and return request auth. */
  async resolveAuth(excludeIds?: ReadonlySet<string>): Promise<RequestAuth> {
    await this.init()
    const now = Date.now()
    const pool = excludeIds ? this.accounts.filter((a) => !excludeIds.has(a.id)) : this.accounts
    if (pool.length === 0) throw new Error('No Antigravity accounts configured. Open Settings → Antigravity and sign in.')

    let chosenId = selectAccount({ accounts: pool, activeId: this.activeId, health: this.health, bucket: this.bucket, now })
    if (chosenId === undefined) {
      const waits = pool.filter((a) => a.enabled && this.health.isUsable(a.id, now) && this.bucket.has(a.id, 1, now))
        .map((a) => Math.max(a.coolingDownUntil ?? 0, ...Object.values(a.rateLimitedUntil ?? {})) - now)
        .filter((wait) => wait > 0)
      const wait = Math.min(...waits)
      const configuredWait = this.options.maxWaitMs ?? 1000
      const bound = Number.isFinite(configuredWait) ? Math.max(0, Math.min(configuredWait, 5000)) : 1000
      if (wait <= bound) {
        await delay(wait, undefined, { signal: this.lifetime.signal })
        chosenId = selectAccount({ accounts: pool.filter((a) => this.accounts.includes(a)), activeId: this.activeId, health: this.health, bucket: this.bucket })
      }
    }
    if (chosenId === undefined) throw new Error('No usable Antigravity account is available right now.')
    const account = this.accounts.find((a) => a.id === chosenId)
    if (!account) throw new Error('Antigravity account selection failed.')

    const access = await this.ensureAccess(account)
    if (!account.enabled || !this.accounts.includes(account) || isRateLimited(account) || isCoolingDown(account) || this.disposed) {
      throw new Error('Antigravity account is no longer available')
    }
    account.lastUsed = Date.now()
    if (!this.bucket.consume(account.id)) throw new Error('Antigravity account request budget was exhausted')
    await this.persist()
    return { token: access, projectId: account.projectId, accountId: account.id }
  }

  /** Ensure the account has a valid access token, refreshing when expired. */
  private async ensureAccess(account: Account): Promise<string> {
    if (this.disposed || !account.enabled || !this.accounts.includes(account)) throw new Error('Antigravity account is unavailable')
    if (account.accessToken && (account.accessExpires ?? 0) > Date.now() + 30_000) {
      return account.accessToken
    }
    const pending = this.refreshes.get(account.id)
    if (pending) return pending
    const operation = this.refreshAccess(account).finally(() => { this.refreshes.delete(account.id) })
    this.refreshes.set(account.id, operation)
    return operation
  }

  private async refreshAccess(account: Account): Promise<string> {
    const refreshToken = account.refreshToken
    const previousAccess = account.accessToken
    const config = await this.clientConfig()
    this.lifetime.signal.throwIfAborted()
    const result = await refreshAccountAccess(refreshToken, config, this.lifetime.signal)
    this.lifetime.signal.throwIfAborted()
    if (!this.accounts.includes(account) || account.refreshToken !== refreshToken || account.accessToken !== previousAccess) throw new Error('Antigravity account changed during refresh')
    if (result.kind === 'revoked') {
      account.enabled = false
      delete account.accessToken
      delete account.accessExpires
      await this.persist()
      if (this.activeId === account.id) await this.options.credentials.unset(this.options.credentialRef)
      throw new Error(`Antigravity account ${account.email ?? account.id.slice(0, 8)} was revoked; sign in again.`)
    }
    if (result.kind === 'error') {
      this.health.failure(account.id)
      account.coolingDownUntil = Date.now() + COOLDOWN_MS
      await this.persist()
      throw new Error(`Antigravity token refresh failed: ${result.message}`)
    }
    account.accessToken = result.access
    account.accessExpires = result.expires
    if (result.refreshToken) account.refreshToken = result.refreshToken
    await this.persist()
    return result.access
  }

  // ---- AuthProvider (rotation hooks used by api.ts) ----------------------

  reportRateLimit(accountId: string, delayMs?: number): void {
    const account = this.accounts.find((a) => a.id === accountId)
    if (account) {
      const delay = delayMs !== undefined && Number.isFinite(delayMs) && delayMs >= 0 ? Math.min(delayMs, 86_400_000) : RATE_LIMIT_WINDOW_MS
      account.rateLimitedUntil = { ...(account.rateLimitedUntil ?? {}), all: Math.max(account.rateLimitedUntil?.all ?? 0, Date.now() + delay) }
      void this.persist().catch(() => { /* Best effort; subsequent operations persist this state. */ })
    }
    this.health.rateLimited(accountId)
  }

  reportSuccess(accountId: string): void {
    this.health.success(accountId)
  }

  reportError(accountId: string): void {
    this.health.failure(accountId)
  }

  /** Get a distinct account's auth after `accountId` was rate-limited. */
  async afterRateLimit(accountId: string): Promise<RequestAuth | undefined> {
    try {
      return await this.resolveAuth(new Set([accountId]))
    } catch {
      return undefined
    }
  }

  /** Resolve pi-ai request auth (single active account, rotation applied). */
  async resolveApiKey(): Promise<string> {
    return JSON.stringify(await this.resolveAuth())
  }

  // ---- Internal helpers ---------------------------------------------------

  private async addCredential(credential: OAuthCredential): Promise<void> {
    const current = credential as OAuthCredential & { projectId: string; email?: string }
    if (typeof current.projectId !== 'string' || current.projectId.length === 0) {
      throw new Error('Antigravity login returned no Cloud Code Assist project id')
    }
    const existing = this.accounts.find((a) => a.refreshToken === credential.refresh || (a.email && a.email === current.email))
    const now = Date.now()
    if (existing) {
      existing.refreshToken = credential.refresh
      existing.projectId = current.projectId
      existing.email = current.email ?? existing.email
      existing.accessToken = credential.access
      existing.accessExpires = credential.expires
      existing.enabled = true
      this.health.reset(existing.id)
      delete existing.rateLimitedUntil
      delete existing.coolingDownUntil
      this.activeId = existing.id
    } else {
      const account: Account = {
        id: randomUUID(),
        email: current.email,
        refreshToken: credential.refresh,
        projectId: current.projectId,
        addedAt: now,
        lastUsed: now,
        accessToken: credential.access,
        accessExpires: credential.expires,
        enabled: true,
      }
      this.accounts.push(account)
      this.activeId = account.id
    }
    await this.persist()
    await this.mirrorActive()
  }

  /** Keep the Harness credential store in sync with the active account. */
  private async mirrorActive(): Promise<void> {
    const account = this.accounts.find((a) => a.id === this.activeId)
    if (!account || !account.enabled) {
      await this.options.credentials.unset(this.options.credentialRef)
      return
    }
    const mirror: OAuthCredential = {
      type: 'oauth',
      access: account.accessToken ?? '',
      refresh: account.refreshToken,
      expires: account.accessExpires ?? 0,
      projectId: account.projectId,
      ...account.email === undefined ? {} : { email: account.email },
    } as OAuthCredential
    await this.options.credentials.set(this.options.credentialRef, JSON.stringify(mirror))
  }
}
