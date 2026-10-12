import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OAUTH_CLIENT_CONFIG_REF,
  embeddedClientConfig,
  parseOAuthClientConfig,
  resolveOAuthClientConfig,
} from '../src/client-config.ts'

const VALID_ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com'
const VALID_SECRET = 'GOCSPX-dummyClientSecretForTests123456'

describe('embeddedClientConfig', () => {
  it('returns the embedded pair in the expected format', () => {
    const config = embeddedClientConfig()
    expect(config.clientId).toMatch(/^[0-9]{6,}-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/)
    expect(config.clientSecret).toMatch(/^GOCSPX-[A-Za-z0-9_-]+$/)
  })
})

describe('parseOAuthClientConfig', () => {
  it('accepts a valid override', () => {
    const parsed = parseOAuthClientConfig(JSON.stringify({ clientId: VALID_ID, clientSecret: VALID_SECRET }))
    expect(parsed).toEqual({ clientId: VALID_ID, clientSecret: VALID_SECRET })
  })

  it('rejects non-JSON', () => {
    expect(() => parseOAuthClientConfig('not json')).toThrow(/valid JSON/)
  })

  it('rejects a non-object', () => {
    expect(() => parseOAuthClientConfig('[]')).toThrow(/JSON object/)
  })

  it('rejects a malformed clientId', () => {
    expect(() => parseOAuthClientConfig(JSON.stringify({ clientId: 'bad', clientSecret: VALID_SECRET }))).toThrow(/clientId/)
  })

  it('rejects a malformed clientSecret', () => {
    expect(() => parseOAuthClientConfig(JSON.stringify({ clientId: VALID_ID, clientSecret: 'nope' }))).toThrow(/clientSecret/)
  })
})

describe('resolveOAuthClientConfig', () => {
  it('returns the embedded pair when no override is stored', async () => {
    const credentials = { resolve: () => Promise.resolve(undefined) }
    const config = await resolveOAuthClientConfig(credentials as never)
    expect(config).toEqual(embeddedClientConfig())
  })

  it('prefers a stored override', async () => {
    const override = JSON.stringify({ clientId: VALID_ID, clientSecret: VALID_SECRET })
    const credentials = { resolve: () => Promise.resolve({ value: override }) }
    const config = await resolveOAuthClientConfig(credentials as never)
    expect(config.clientId).toBe(VALID_ID)
  })

  it('uses the default credential reference', async () => {
    expect(DEFAULT_OAUTH_CLIENT_CONFIG_REF).toBe('GOOGLE_ANTIGRAVITY_OAUTH_CLIENT_CONFIG')
  })
})
