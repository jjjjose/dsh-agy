import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { registerRpc, ROUTE_PREFIX } from '../src/rpc.ts'
import type { Diagnostics } from '../src/diagnostics.ts'
import type { AccountManager } from '../src/manager.ts'
import type { HttpLikeRequest, HttpLikeResponse, WebServerService } from '../src/dsh-context.ts'

function harness(rejection?: number, available = true) {
  let handler!: Parameters<WebServerService['register']>[0]['handler']
  const snapshot = { enabled: false, version: '0.1.1', limit: 200, entries: [] }
  const diagnostics = { snapshot: vi.fn(() => snapshot), configure: vi.fn(async (_enabled: boolean) => snapshot), clear: vi.fn(() => snapshot) }
  registerRpc({ register(route) { handler = route.handler; return () => undefined } }, { requestRejection: () => rejection }, {} as AccountManager, { diagnostics: available ? diagnostics as unknown as Diagnostics : undefined })
  return { diagnostics, async request(method: string, route: string, body: unknown = {}) {
    let code = 0, result: unknown
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method, url: `${ROUTE_PREFIX}/diagnostics${route}`, headers: {} }) as HttpLikeRequest
    const res: HttpLikeResponse = { writeHead(status) { code = status; return this }, end(value) { result = JSON.parse(value ?? '{}') } }
    await handler(req, res)
    return { code, result }
  } }
}
describe('diagnostic RPC', () => {
  it('rejects untrusted reads and mutations before accessing logs', async () => {
    const host = harness(403)
    for (const [method, path] of [['GET', ''], ['POST', '/config'], ['POST', '/clear']]) expect((await host.request(method!, path!, { enabled: true })).code).toBe(403)
    expect(host.diagnostics.snapshot).not.toHaveBeenCalled()
    expect(host.diagnostics.configure).not.toHaveBeenCalled()
    expect(host.diagnostics.clear).not.toHaveBeenCalled()
  })
  it('serves snapshots and requires POST for configuration and clearing', async () => {
    const host = harness()
    expect((await host.request('GET', '')).code).toBe(200)
    expect((await host.request('GET', '/config')).code).toBe(404)
    expect((await host.request('GET', '/clear')).code).toBe(404)
    expect((await host.request('POST', '/config', { enabled: true })).code).toBe(200)
    expect(host.diagnostics.configure).toHaveBeenCalledWith(true)
    expect((await host.request('POST', '/clear')).code).toBe(200)
    expect(host.diagnostics.clear).toHaveBeenCalledOnce()
  })
  it('validates config and maps persistence failures to generic errors', async () => {
    const host = harness()
    for (const body of [{}, { enabled: 'true' }, { enabled: true, token: 'secret' }]) expect((await host.request('POST', '/config', body)).code).toBe(400)
    expect((await host.request('POST', '/clear', { enabled: true })).code).toBe(400)
    host.diagnostics.configure.mockRejectedValueOnce(new Error('private path'))
    expect(await host.request('POST', '/config', { enabled: true })).toEqual({ code: 500, result: { error: 'The operation failed. Check account status and try again.' } })
    expect((await harness(undefined, false).request('GET', '')).code).toBe(503)
  })
})
