import { describe, expect, it } from 'vitest'
import {
  ANTIGRAVITY_CLIENT_ID,
  ANTIGRAVITY_CLIENT_SECRET,
  ANTIGRAVITY_SCOPES,
  ENDPOINTS,
  OAUTH_CALLBACK_PORT,
  REDIRECT_URI,
  antiGravityHeaders,
} from '../src/constants.ts'

describe('OAuth constants', () => {
  it('embeds a well-formed client id and secret', () => {
    expect(ANTIGRAVITY_CLIENT_ID).toMatch(/^[0-9]{6,}-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/)
    expect(ANTIGRAVITY_CLIENT_SECRET).toMatch(/^GOCSPX-[A-Za-z0-9_-]+$/)
  })

  it('targets the fixed localhost callback', () => {
    expect(OAUTH_CALLBACK_PORT).toBe(51121)
    expect(REDIRECT_URI).toBe('http://localhost:51121/oauth-callback')
  })

  it('requests the Antigravity scopes', () => {
    expect(ANTIGRAVITY_SCOPES).toContain('https://www.googleapis.com/auth/cloud-platform')
    expect(ANTIGRAVITY_SCOPES.length).toBeGreaterThanOrEqual(4)
  })

  it('lists Cloud Code Assist endpoints', () => {
    expect(ENDPOINTS.length).toBeGreaterThanOrEqual(1)
    for (const endpoint of ENDPOINTS) expect(endpoint).toMatch(/^https:\/\/.*googleapis\.com$/)
  })
})

describe('antiGravityHeaders', () => {
  it('sets the bearer token and official metadata headers', () => {
    const headers = antiGravityHeaders('tok123')
    expect(headers.authorization).toBe('Bearer tok123')
    expect(headers['content-type']).toBe('application/json')
    expect(headers['client-metadata']).toContain('ANTIGRAVITY')
    expect(headers['x-goog-api-client']).toBeDefined()
    expect(headers['user-agent']).toMatch(/^antigravity\//)
  })

  it('reports a platform-specific user agent', () => {
    const headers = antiGravityHeaders('t')
    expect(headers['user-agent']).toMatch(/windows\/amd64|darwin\/arm64|linux\/amd64/)
  })
})
