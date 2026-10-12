/** Shared types for the dsh-agy plugin. */

/** Opaque identity of one in-process login attempt. */
export type LoginId = string

/** Credential status safe for browser display. */
export interface AuthSnapshot {
  readonly configured: boolean
  readonly source?: string
}

/** Browser handoff returned once the local callback listener is ready. */
export interface LoginStart {
  readonly loginId: LoginId
  readonly authorizationUrl: string
}

/** Pollable state of one OAuth attempt. */
export type LoginStatus =
  | { readonly kind: 'pending' }
  | { readonly kind: 'succeeded'; readonly email?: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'cancelled' }

/** A resolved OAuth token set for one account. */
export interface OAuthTokens {
  access: string
  refresh: string
  /** Epoch milliseconds when the access token expires (with safety margin). */
  expires: number
  email?: string
  projectId: string
}

/** Stored OAuth credential: pi-ai's `OAuthCredential` plus the project id. */
export interface AntiGravityCredential {
  type: 'oauth'
  access: string
  refresh: string
  expires: number
  projectId: string
  email?: string
}

/** Per-account device fingerprint used to keep request identity stable. */
export interface Fingerprint {
  deviceId: string
  userAgent: string
}

/** One account in the persistent pool. */
export interface Account {
  /** Stable local id. */
  id: string
  email?: string
  refreshToken: string
  projectId: string
  addedAt: number
  lastUsed: number
  /** Cached access token + expiry (refreshed on demand). */
  accessToken?: string
  accessExpires?: number
  fingerprint?: Fingerprint
  /** Epoch ms until which this account is considered rate-limited, per family. */
  rateLimitedUntil?: Record<string, number>
  /** Epoch ms until which this account cools down after auth/network errors. */
  coolingDownUntil?: number
  enabled: boolean
}

/** Versioned on-disk account pool. */
export interface AccountStorage {
  version: 1
  accounts: Account[]
  activeId?: string
}

/** Quota bucket window identifiers. */
export type QuotaWindow = '5h' | 'weekly' | string

export interface QuotaBucket {
  window: QuotaWindow
  label: string
  remainingFraction: number
  remainingPercentage: number
  resetTime: Date
  timeUntilReset: number
  timeUntilResetFormatted: string
}

export interface AccountQuotaResult {
  accountId: string
  email?: string
  status: 'ok' | 'disabled' | 'error'
  error?: string
  buckets: QuotaBucket[]
}

/** The JSON envelope sent to Cloud Code Assist for inference. */
export interface AntigravityEnvelope {
  project: string
  model: string
  request: Record<string, unknown>
  requestType: 'agent'
  userAgent: string
  requestId: string
}
