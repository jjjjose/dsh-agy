import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { registerRpc, ROUTE_PREFIX } from '../src/rpc.ts'
import type { ModelCatalog } from '../src/catalog.ts'
import type { AccountManager } from '../src/manager.ts'
import type { HttpLikeRequest, HttpLikeResponse, WebServerService } from '../src/dsh-context.ts'

function harness(rejection?: number) {
  let handler!: Parameters<WebServerService['register']>[0]['handler']
  const status = { source: 'google', modelCount: 2, variantCount: 5, updatedAt: 1000, ignoredCount: 0, refreshing: false }
  const catalog = { status: vi.fn(() => status) }
  const refresh = vi.fn(async () => undefined)
  registerRpc({ register(route) { handler = route.handler; return () => undefined } }, { requestRejection: () => rejection }, {} as AccountManager, { catalog: catalog as unknown as ModelCatalog, refreshModels: refresh })
  return { catalog, refresh, async request(method: string, path: string) {
    let code = 0, result: unknown
    const req = Object.assign(Readable.from([Buffer.from('{}')]), { method, url: `${ROUTE_PREFIX}/${path}`, headers: {} }) as HttpLikeRequest
    const res: HttpLikeResponse = { writeHead(status) { code = status; return this }, end(value) { result = JSON.parse(value ?? '{}') } }
    await handler(req, res)
    return { code, result }
  } }
}
describe('model catalog RPC', () => {
  it('serves status and awaits refresh before returning its result', async () => {
    const host = harness()
    expect(await host.request('GET', 'models/status')).toMatchObject({ code: 200, result: { modelCount: 2, source: 'google' } })
    expect(host.refresh).not.toHaveBeenCalled()
    let resolve!: () => void
    host.refresh.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done }))
    const pending = host.request('POST', 'refresh-models')
    await vi.waitFor(() => expect(host.refresh).toHaveBeenCalledOnce())
    resolve()
    expect(await pending).toMatchObject({ code: 200, result: { catalog: { variantCount: 5 } } })
    expect((await host.request('GET', 'refresh-models')).code).toBe(404)
  })
  it('rejects untrusted catalog reads and refreshes', async () => {
    const host = harness(403)
    expect((await host.request('GET', 'models/status')).code).toBe(403)
    expect((await host.request('POST', 'refresh-models')).code).toBe(403)
    expect(host.catalog.status).not.toHaveBeenCalled()
    expect(host.refresh).not.toHaveBeenCalled()
  })
})
