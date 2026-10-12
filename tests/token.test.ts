import { afterEach, describe, expect, it, vi } from 'vitest'
import { refreshAccountAccess } from '../src/token.ts'

const clientConfig = { clientId: 'id', clientSecret: 'secret' }

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

describe('refreshAccountAccess', () => {
  it('returns ok with a fresh access token and expiry margin', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(jsonResponse(200, {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
    })))
    const before = Date.now()
    const result = await refreshAccountAccess('old-refresh', clientConfig)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.access).toBe('new-access')
      expect(result.refreshToken).toBe('new-refresh')
      // ~1h minus the 5-minute safety margin
      expect(result.expires).toBeGreaterThanOrEqual(before + 3_300_000)
      expect(result.expires).toBeLessThanOrEqual(Date.now() + 3_600_000)
    }
  })

  it('keeps the old refresh token when none is returned', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(jsonResponse(200, { access_token: 'a', expires_in: 60 })))
    const result = await refreshAccountAccess('old-refresh', clientConfig)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.refreshToken).toBeUndefined()
  })

  it('reports revocation on invalid_grant', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(jsonResponse(400, { error: 'invalid_grant' })))
    const result = await refreshAccountAccess('revoked', clientConfig)
    expect(result.kind).toBe('revoked')
  })

  it('reports a non-auth HTTP failure as an error', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(jsonResponse(500, { error: 'boom' })))
    const result = await refreshAccountAccess('r', clientConfig)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.status).toBe(500)
  })

  it('reports a thrown fetch as an error', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('network down')))
    const result = await refreshAccountAccess('r', clientConfig)
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.message).toContain('network down')
  })
})
