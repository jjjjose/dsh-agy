/**
 * Resolve the OAuth application identity (client id + secret).
 *
 * Default source is the embedded pair, which works on every platform with zero
 * configuration. A deployment may override it by storing a JSON document at the
 * GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_CONFIG credential reference; no macOS
 * installation is required (unlike the reference dsh-antigravity plugin, which
 * imports the pair from a signed Antigravity IDE.app).
 */

import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import { ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET } from './constants.ts'

/** Default credential reference for a private OAuth client override. */
export const DEFAULT_OAUTH_CLIENT_CONFIG_REF = 'GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_CONFIG'

const CLIENT_ID_PATTERN = /^[0-9]{6,}-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/
const CLIENT_SECRET_PATTERN = /^GOCSPX-[A-Za-z0-9_-]+$/
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** OAuth application identity used for login and refresh. */
export interface OAuthClientConfig {
  clientId: string
  clientSecret: string
}

/** The embedded, cross-platform OAuth client identity. */
export function embeddedClientConfig(): OAuthClientConfig {
  return { clientId: ANTIGRAVITY_CLIENT_ID, clientSecret: ANTIGRAVITY_CLIENT_SECRET }
}

/**
 * Parse and validate a serialized OAuth client override.
 * @param value - JSON document with `clientId` and `clientSecret`.
 * @returns validated client identity.
 */
export function parseOAuthClientConfig(value: string): OAuthClientConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Antigravity OAuth client configuration is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Antigravity OAuth client configuration must be a JSON object')
  }
  const { clientId, clientSecret } = parsed as Record<string, unknown>
  if (typeof clientId !== 'string' || !CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error('Antigravity OAuth client configuration has an invalid clientId')
  }
  if (typeof clientSecret !== 'string' || !CLIENT_SECRET_PATTERN.test(clientSecret)) {
    throw new Error('Antigravity OAuth client configuration has an invalid clientSecret')
  }
  return { clientId, clientSecret }
}

/**
 * Resolve the effective client identity: an explicit credential override when
 * present, otherwise the embedded pair.
 * @param credentials - Harness credential store.
 * @param refValue - credential reference name for the override document.
 * @returns client identity for the next OAuth operation.
 */
export async function resolveOAuthClientConfig(
  credentials: Pick<CredentialProvider, 'resolve'>,
  refValue: string = DEFAULT_OAUTH_CLIENT_CONFIG_REF,
): Promise<OAuthClientConfig> {
  if (!CREDENTIAL_REF_PATTERN.test(refValue)) {
    throw new Error('Antigravity OAuth client credential reference must be a POSIX identifier')
  }
  const existing = await credentials.resolve(refValue as CredentialRef)
  if (existing !== undefined) return parseOAuthClientConfig(existing.value)
  return embeddedClientConfig()
}
