/**
 * Google Antigravity OAuth: PKCE login on a localhost callback, token exchange,
 * and Cloud Code Assist project discovery. Implements pi-ai's `OAuthAuth`
 * contract so the Harness can drive login/refresh through the provider.
 */

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AuthEvent, AuthInteraction, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai'
import type { AntiGravityCredential } from './types.ts'
import {
  ANTIGRAVITY_SCOPES,
  AUTHORIZE_URL,
  ENDPOINTS,
  OAUTH_CALLBACK_PATH,
  OAUTH_CALLBACK_PORT,
  REDIRECT_URI,
  TOKEN_URL,
  USERINFO_URL,
  antiGravityHeaders,
} from './constants.ts'

// Re-exported for callers that import headers from the auth module.
export { antiGravityHeaders } from './constants.ts'

/** Credential shape this provider stores, with the required project id. */
function base64Url(input: Buffer): string {
  return input.toString('base64url')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Resolve the Cloud Code Assist companion project for an access token.
 * @param access - current OAuth access token.
 * @param signal - optional cancellation signal.
 * @returns the companion project id.
 */
export async function discoverProject(access: string, signal?: AbortSignal): Promise<string> {
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: 'POST',
        headers: antiGravityHeaders(access),
        body: JSON.stringify({
          metadata: { ideName: 'antigravity', ideType: 'ANTIGRAVITY', ideVersion: '2.5.2' },
        }),
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) continue
      const body = (await response.json()) as Record<string, unknown>
      const project = body.cloudaicompanionProject
      if (typeof project === 'string' && project.length > 0) return project
      if (isRecord(project) && typeof project.id === 'string' && project.id.length > 0) return project.id
    } catch (error) {
      if (signal?.aborted) throw error
    }
  }
  throw new Error('Antigravity OAuth succeeded, but Cloud Code Assist returned no companion project')
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

/** Exchange an authorization code (or refresh token) for access tokens. */
async function exchange(params: URLSearchParams, signal?: AbortSignal): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
    ...signal === undefined ? {} : { signal },
  })
  if (!response.ok) {
    throw new Error(`Antigravity token exchange failed with HTTP ${response.status}`)
  }
  const tokens = await response.json() as TokenResponse
  if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token
    || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0
    || (tokens.refresh_token !== undefined && (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token))) {
    throw new Error('Invalid Antigravity OAuth token response')
  }
  return tokens
}

async function fetchEmail(access: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${access}` },
      ...signal === undefined ? {} : { signal },
    })
    if (!response.ok) return undefined
    const body = (await response.json()) as Record<string, unknown>
    return typeof body.email === 'string' ? body.email : undefined
  } catch {
    return undefined
  }
}

interface OAuthClientPair {
  clientId: string
  clientSecret: string
}

/**
 * Run the full login: PKCE + localhost callback + exchange + project discovery.
 * @param interaction - Harness-provided notify/prompt/signal bridge.
 * @param clientConfig - resolved OAuth client identity.
 * @returns the stored OAuth credential including the companion project id.
 */
async function login(
  interaction: AuthInteraction,
  clientConfig: OAuthClientPair,
): Promise<OAuthCredential> {
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  const state = base64Url(randomBytes(24))

  const auth = new URL(AUTHORIZE_URL)
  auth.search = new URLSearchParams({
    client_id: clientConfig.clientId, response_type: 'code', redirect_uri: REDIRECT_URI,
    scope: ANTIGRAVITY_SCOPES.join(' '), code_challenge: challenge,
    code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
  }).toString()
  interaction.signal?.throwIfAborted()
  const code = await new Promise<string>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      settled = true
      clearTimeout(timeout)
      interaction.signal?.removeEventListener('abort', abort)
      server.close()
    }
    const abort = (): void => { cleanup(); reject(new Error('Antigravity OAuth was cancelled')) }
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Antigravity OAuth timed out')) }, 300_000)
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', REDIRECT_URI)
      if (url.pathname !== OAUTH_CALLBACK_PATH) {
        response.writeHead(404).end()
        return
      }
      const receivedCode = url.searchParams.get('code')
      if (url.searchParams.get('state') === state && url.searchParams.has('error')) {
        response.writeHead(400).end('Antigravity authorization was declined.')
        cleanup()
        reject(new Error('Antigravity authorization was declined'))
        return
      }
      if (url.searchParams.get('state') !== state || !receivedCode) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('Antigravity OAuth callback is invalid.')
        return
      }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Antigravity login completed. You may close this page.')
      cleanup()
      resolve(receivedCode)
    })
    server.on('error', (error) => {
      cleanup()
      reject(new Error(`Could not start the Antigravity OAuth callback on port ${OAUTH_CALLBACK_PORT}: ${error.message}. Close other Antigravity sessions and retry.`))
    })
    server.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
      if (settled) { server.close(); return }
      try {
        interaction.notify({ type: 'auth_url', url: auth.toString(), instructions: 'Complete the Google Antigravity authorization in your browser.' } as AuthEvent)
      } catch (error) { cleanup(); reject(error) }
    })
    interaction.signal?.addEventListener('abort', abort, { once: true })
    if (interaction.signal?.aborted) abort()
  })

  const tokens = await exchange(new URLSearchParams({
    client_id: clientConfig.clientId,
    client_secret: clientConfig.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  }), interaction.signal)

  if (tokens.refresh_token === undefined) {
    throw new Error('Antigravity OAuth returned no refresh token; revoke prior grants and retry.')
  }
  const projectId = await discoverProject(tokens.access_token, interaction.signal)
  const email = await fetchEmail(tokens.access_token, interaction.signal)

  const credential: AntiGravityCredential = {
    type: 'oauth',
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + tokens.expires_in * 1000 - 300_000,
    projectId,
    email,
  }
  return credential as unknown as OAuthCredential
}

/** Seconds of safety margin subtracted from `expires_in` before refresh. */
const EXPIRY_MARGIN_MS = 300_000

/**
 * Build the provider-native OAuth handler around a per-operation client-config
 * resolver.
 * @param resolveClientConfig - resolves the client id/secret for each operation.
 * @returns pi-ai `OAuthAuth` used by the credential manager and remote service.
 */
export function createAntiGravityOAuth(
  resolveClientConfig: () => Promise<OAuthClientPair>,
): OAuthAuth {
  return {
    name: 'Google Antigravity',
    loginLabel: 'Sign in with your Google account (Antigravity)',
    login: async (interaction) => login(interaction, await resolveClientConfig()),
    async refresh(credential, signal) {
      const current = credential as unknown as AntiGravityCredential
      if (typeof current.projectId !== 'string' || current.projectId.length === 0) {
        throw new Error('Antigravity credential has no Cloud Code Assist project id')
      }
      const clientConfig = await resolveClientConfig()
      const tokens = await exchange(new URLSearchParams({
        client_id: clientConfig.clientId,
        client_secret: clientConfig.clientSecret,
        refresh_token: credential.refresh,
        grant_type: 'refresh_token',
      }), signal)
      return {
        ...credential,
        access: tokens.access_token,
        refresh: tokens.refresh_token ?? credential.refresh,
        expires: Date.now() + tokens.expires_in * 1000 - EXPIRY_MARGIN_MS,
      }
    },
    toAuth: (credential) => {
      const current = credential as unknown as AntiGravityCredential
      if (typeof current.projectId !== 'string' || current.projectId.length === 0) {
        throw new Error('Antigravity credential has no Cloud Code Assist project id')
      }
      return Promise.resolve({ apiKey: JSON.stringify({ token: credential.access, projectId: current.projectId }) })
    },
  }
}

// (end of module)
