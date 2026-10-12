import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { registerRpc, ROUTE_PREFIX } from '../src/rpc.ts'
import { UpdateInputError } from '../src/self-update.ts'
import type { SelfUpdater } from '../src/self-update.ts'
import type { AccountManager } from '../src/manager.ts'
import type { HttpLikeRequest, HttpLikeResponse, WebServerService } from '../src/dsh-context.ts'

function harness(rejection?: number) {
  let handler!: Parameters<WebServerService['register']>[0]['handler']
  const payload = { configured: false, latest: null }
  const updater = {
    visitSettings: vi.fn(() => payload), check: vi.fn(async () => payload), update: vi.fn(async () => payload),
    configure: vi.fn(async (_body: Record<string, unknown>) => payload),
  }
  registerRpc({ register(route) { handler = route.handler; return () => undefined } }, { requestRejection: () => rejection }, {} as AccountManager, { updater: updater as unknown as SelfUpdater })
  return {
    updater,
    async request(method: string, route: string, body: unknown = {}) {
      let code = 0, result: unknown
      const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method, url: `${ROUTE_PREFIX}/update/${route}`, headers: {} }) as HttpLikeRequest
      const res: HttpLikeResponse = { writeHead(status) { code = status; return this }, end(value) { result = JSON.parse(value ?? '{}') } }
      await handler(req, res)
      return { code, result }
    },
  }
}
describe('self-update RPC trust and mutation boundaries', () => {
  it('rejects untrusted requests before any updater action', async () => {
    const host = harness(403)
    expect((await host.request('POST', 'install', { confirm: true })).code).toBe(403)
    expect(host.updater.visitSettings).not.toHaveBeenCalled()
    expect(host.updater.update).not.toHaveBeenCalled()
  })
  it('status is read-only except pausing the session scheduler', async () => {
    const host = harness()
    expect((await host.request('GET', 'status')).result).toEqual({ configured: false, latest: null })
    expect(host.updater.visitSettings).toHaveBeenCalledOnce()
    expect(host.updater.check).not.toHaveBeenCalled()
    expect(host.updater.configure).not.toHaveBeenCalled()
  })
  it('GET cannot check, install or configure', async () => {
    const host = harness()
    for (const route of ['check', 'install', 'config']) expect((await host.request('GET', route)).code).toBe(404)
    expect(host.updater.check).not.toHaveBeenCalled()
    expect(host.updater.update).not.toHaveBeenCalled()
    expect(host.updater.configure).not.toHaveBeenCalled()
  })
  it('check-only never delegates installation', async () => {
    const host = harness()
    expect((await host.request('POST', 'check')).code).toBe(200)
    expect(host.updater.check).toHaveBeenCalledOnce()
    expect(host.updater.update).not.toHaveBeenCalled()
  })
  it('install requires explicit boolean confirmation', async () => {
    const host = harness()
    for (const body of [{}, { confirm: 'true' }, { confirm: false }]) expect((await host.request('POST', 'install', body)).code).toBe(400)
    expect(host.updater.update).not.toHaveBeenCalled()
    expect((await host.request('POST', 'install', { confirm: true })).code).toBe(200)
    expect(host.updater.update).toHaveBeenCalledOnce()
  })
  it('passes partial config and maps validation failures to 400', async () => {
    const host = harness()
    await host.request('POST', 'config', { enabled: false, intervalMs: 60000 })
    expect(host.updater.configure).toHaveBeenCalledWith({ enabled: false, intervalMs: 60000 })
    host.updater.configure.mockRejectedValueOnce(new UpdateInputError('Invalid registry origin'))
    expect((await host.request('POST', 'config', { registryOrigin: 'http://bad' })).code).toBe(400)
  })
})
