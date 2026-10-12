/**
 * Refresh a single account's OAuth access token. Refresh tokens are long lived;
 * the access token is short lived and is renewed on demand by the account
 * manager. A `invalid_grant` response means Google revoked the token and the
 * account must be re-authorized.
 */

import { TOKEN_URL } from './constants.ts'
import type { OAuthClientConfig } from './client-config.ts'

/** Margin subtracted from `expires_in` so tokens refresh before they lapse. */
const EXPIRY_MARGIN_MS = 300_000

/** Outcome of one refresh attempt. */
export type RefreshResult =
  | { kind: 'ok'; access: string; expires: number; refreshToken?: string }
  | { kind: 'revoked' }
  | { kind: 'error'; message: string; status?: number }

interface TokenPayload {
  access_token: string
  refresh_token?: string
  expires_in: number
}

interface OAuthErrorPayload {
  error?: string | { code?: string; status?: string; message?: string }
  error_description?: string
}

/** Parse a Google OAuth error body tolerating varied shapes. */
function parseOAuthError(text: string | undefined): { code?: string; description?: string } {
  if (!text) return {}
  try {
    const payload = JSON.parse(text) as OAuthErrorPayload
    if (!payload || typeof payload !== 'object') return { description: text }
    let code: string | undefined
    if (typeof payload.error === 'string') {
      code = payload.error
    } else if (payload.error && typeof payload.error === 'object') {
      code = payload.error.status ?? payload.error.code
      if (!payload.error_description && payload.error.message) return { code, description: payload.error.message }
    }
    const description = payload.error_description
    if (description) return { code, description }
    if (payload.error && typeof payload.error === 'object' && payload.error.message) {
      return { code, description: payload.error.message }
    }
    return { code }
  } catch {
    return { description: text }
  }
}

/**
 * Exchange a refresh token for a fresh access token.
 * @param refreshToken - the account's stored refresh token.
 * @param clientConfig - resolved OAuth client identity.
 * @returns a discriminated refresh outcome.
 */
export async function refreshAccountAccess(
  refreshToken: string,
  clientConfig: OAuthClientConfig,
): Promise<RefreshResult> {
  let response: Response
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientConfig.clientId,
        client_secret: clientConfig.clientSecret,
      }),
    })
  } catch (error) {
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => undefined)
    const { code, description } = parseOAuthError(text)
    if (code === 'invalid_grant' || response.status === 400 || response.status === 401) {
      return { kind: 'revoked' }
    }
    return { kind: 'error', message: description ?? text ?? `HTTP ${response.status}`, status: response.status }
  }

  const payload = (await response.json()) as TokenPayload
  return {
    kind: 'ok',
    access: payload.access_token,
    expires: Date.now() + payload.expires_in * 1000 - EXPIRY_MARGIN_MS,
    ...payload.refresh_token === undefined ? {} : { refreshToken: payload.refresh_token },
  }
}
