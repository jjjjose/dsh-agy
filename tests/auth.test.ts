import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthInteraction } from '@earendil-works/pi-ai'

const http = vi.hoisted(() => ({
  handler: undefined as undefined | ((request: { url: string }, response: { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }) => void),
  close: vi.fn(),
}))
vi.mock('node:http', () => ({
  createServer: (handler: typeof http.handler) => {
    http.handler = handler
    return { close: http.close, on: vi.fn(), listen: (_port: number, _host: string, ready: () => void) => queueMicrotask(ready) }
  },
}))
import { createAntiGravityOAuth } from '../src/auth.ts'

beforeEach(() => { vi.clearAllMocks(); http.handler = undefined })
afterEach(() => vi.unstubAllGlobals())

function callback(url: string) {
  const response = { writeHead: vi.fn(), end: vi.fn() }
  response.writeHead.mockReturnValue(response)
  http.handler?.({ url }, response)
  return response
}

describe('OAuth local PKCE login', () => {
  it('publishes the URL before waiting and validates state without consuming an invalid callback', async () => {
    const notify = vi.fn()
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ cloudaicompanionProject: 'test-project' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({})))
    vi.stubGlobal('fetch', fetch)
    const oauth = createAntiGravityOAuth(async () => ({ clientId: 'test-client', clientSecret: 'test-secret' }))
    const login = oauth.login({ notify, prompt: vi.fn() } as unknown as AuthInteraction)
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce())
    const url = new URL(notify.mock.calls[0]![0].url as string)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBeTruthy()
    const path = new URL(url.searchParams.get('redirect_uri')!).pathname
    expect(callback(`${path}?state=wrong&code=test-code`).writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    expect(fetch).not.toHaveBeenCalled()
    callback(`${path}?state=${url.searchParams.get('state')}&code=test-code`)
    expect((await login).access).toBe('test-access')
    const params = fetch.mock.calls[0]![1].body as URLSearchParams
    expect(params.get('code_verifier')).toBeTruthy()
    expect(http.close).toHaveBeenCalled()
  })

  it('rejects a pre-aborted login without starting the listener', async () => {
    const controller = new AbortController()
    controller.abort()
    const oauth = createAntiGravityOAuth(async () => ({ clientId: 'test-client', clientSecret: 'test-secret' }))
    await expect(oauth.login({ signal: controller.signal, notify: vi.fn(), prompt: vi.fn() } as unknown as AuthInteraction)).rejects.toThrow()
    expect(http.handler).toBeUndefined()
  })

  it('closes the local listener when cancellation occurs', async () => {
    const controller = new AbortController()
    const notify = vi.fn()
    const oauth = createAntiGravityOAuth(async () => ({ clientId: 'test-client', clientSecret: 'test-secret' }))
    const login = oauth.login({ signal: controller.signal, notify, prompt: vi.fn() } as unknown as AuthInteraction)
    const rejected = expect(login).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce())
    controller.abort()
    await rejected
    expect(http.close).toHaveBeenCalledOnce()
  })
})
