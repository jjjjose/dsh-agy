import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { registerRpc, ROUTE_PREFIX } from '../src/rpc.ts'
import type { HttpLikeRequest, HttpLikeResponse, WebServerService } from '../src/dsh-context.ts'
import type { AccountManager } from '../src/manager.ts'
import { EngineStats } from '../src/stats.ts'

function harness(rejection?: number) {
  let handler!: Parameters<WebServerService['register']>[0]['handler']
  const manager = { list: vi.fn(async () => []), startLogin: vi.fn(), remove: vi.fn(), setActive: vi.fn() }
  const stats = new EngineStats()
  registerRpc({ register: (route) => { handler = route.handler; return () => {} } }, { requestRejection: () => rejection }, manager as unknown as AccountManager, { stats })
  return {
    manager, stats,
    async request(method: string, path: string, body = '') {
      let status = 0
      let headers: Record<string, string> = {}
      let data: Record<string, unknown> = {}
      const request = Object.assign(Readable.from(body ? [Buffer.from(body)] : []), { method, url: `${ROUTE_PREFIX}/${path}`, headers: {} }) as HttpLikeRequest
      const response: HttpLikeResponse = {
        writeHead(code, value) { status = code; headers = value ?? {}; return this },
        end(value) { data = JSON.parse(value ?? '{}') },
      }
      await handler(request, response)
      return { status, headers, data }
    },
  }
}

describe('settings RPC', () => {
  it('rejects unauthenticated requests before accessing accounts', async () => {
    const host = harness(401)
    expect((await host.request('GET', 'status')).status).toBe(401)
    expect(host.manager.list).not.toHaveBeenCalled()
  })
  it('returns safe account views with no-store', async () => {
    const result = await harness().request('GET', 'status')
    expect(result.data).toEqual({ accounts: [] })
    expect(result.headers['cache-control']).toBe('no-store')
  })
  it('does not permit login through GET', async () => {
    const host = harness()
    expect((await host.request('GET', 'login')).status).toBe(404)
    expect(host.manager.startLogin).not.toHaveBeenCalled()
  })
  it('rejects malformed and array request bodies', async () => {
    const host = harness()
    expect((await host.request('POST', 'login', '{')).status).toBe(400)
    expect((await host.request('POST', 'login', '[]')).status).toBe(400)
    expect(host.manager.startLogin).not.toHaveBeenCalled()
  })
  it('requires an account identifier for activation', async () => {
    const host = harness()
    expect((await host.request('POST', 'activate', '{}')).status).toBe(400)
    expect(host.manager.setActive).not.toHaveBeenCalled()
  })
  it('does not turn an invalid account identifier into disconnect-all', async () => {
    const host = harness()
    expect((await host.request('POST', 'logout', '{"accountId":42}')).status).toBe(400)
    expect(host.manager.remove).not.toHaveBeenCalled()
  })
  it('exposes runtime activity without credentials', async () => {
    const host = harness()
    host.stats.record('id', 'success')
    const result = await host.request('GET', 'stats')
    expect(result.data.accounts).toEqual([{ accountId: 'id', success: 1, rateLimits: 0, errors: 0 }])
  })
})
