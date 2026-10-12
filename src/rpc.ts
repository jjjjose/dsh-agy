/**
 * JSON RPC exposed to the plugin settings page over the Harness web server.
 *
 * Uses the official trust boundary (`connection.requestRejection`) for auth and
 * anti-rebinding. GET serves reads; POST is required for mutations. Route
 * handlers never expose token values, only account metadata and login state.
 */

import type { ConnectionService, HttpLikeRequest, HttpLikeResponse, WebServerService } from './dsh-context.ts'
import type { AccountManager } from './manager.ts'
import type { AccountQuotaResult } from './types.ts'
import { formatQuotaReport, fetchAccountQuota } from './quota.ts'

export const ROUTE_PREFIX = '/_dsh/dsh-agy'
const MAX_BODY_BYTES = 64 * 1024

function send(res: HttpLikeResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

async function readJsonBody(req: HttpLikeRequest): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  const readable = req as unknown as NodeJS.ReadableStream & { on(event: 'data', cb: (c: Buffer) => void): void; on(event: 'end', cb: () => void): void }
  await new Promise<void>((resolve) => {
    readable.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) chunks.push(chunk)
    })
    readable.on('end', () => resolve())
  })
  if (size > MAX_BODY_BYTES) throw new Error('Request body too large')
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) return {}
  const parsed = JSON.parse(text) as unknown
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
}

function pathOf(req: HttpLikeRequest): { path: string; search: URLSearchParams } {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const raw = url.pathname
  const path = raw.startsWith(ROUTE_PREFIX) ? raw.slice(ROUTE_PREFIX.length) : raw
  return { path, search: url.searchParams }
}

/**
 * Register the RPC routes on the Harness web server.
 * @param webServer - Harness web server service.
 * @param connection - Harness connection gate.
 * @param manager - the account manager driving every method.
 * @returns a disposer that unregisters the routes.
 */
export function registerRpc(
  webServer: WebServerService,
  connection: ConnectionService,
  manager: AccountManager,
): () => void {
  return webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        const status = typeof rejection === 'number' ? rejection : 403
        send(res, status, { error: status === 401 ? 'authentication required' : 'request rejected' })
        return
      }
      try {
        const { path, search } = pathOf(req)
        const method = req.method ?? 'GET'

        if (method === 'GET') {
          if (path === '/status') {
            send(res, 200, { accounts: await manager.list() })
            return
          }
          if (path === '/poll') {
            const loginId = search.get('loginId') ?? ''
            send(res, 200, manager.pollLogin(loginId))
            return
          }
          if (path === '/quota') {
            const qu = await manager.quotaAccounts()
            const results: AccountQuotaResult[] = []
            for (const acc of qu) {
              if (!acc.enabled || !acc.access) {
                results.push({ accountId: acc.id, email: acc.email, status: acc.enabled ? 'error' : 'disabled', error: acc.enabled ? 'token unavailable' : undefined, buckets: [] })
                continue
              }
              results.push(await fetchAccountQuota({ id: acc.id, email: acc.email, refreshToken: '', projectId: acc.projectId, addedAt: 0, lastUsed: 0, enabled: acc.enabled }, acc.access))
            }
            send(res, 200, { report: formatQuotaReport(results) })
            return
          }
          send(res, 404, { error: 'not found' })
          return
        }

        if (method === 'POST') {
          const body = await readJsonBody(req)
          if (path === '/login') {
            const start = await manager.startLogin()
            send(res, 200, start)
            return
          }
          if (path === '/logout') {
            const accountId = typeof body.accountId === 'string' ? body.accountId : undefined
            await manager.remove(accountId)
            send(res, 200, { ok: true })
            return
          }
          if (path === '/activate') {
            const accountId = typeof body.accountId === 'string' ? body.accountId : ''
            const ok = await manager.setActive(accountId)
            send(res, ok ? 200 : 404, { ok })
            return
          }
          send(res, 404, { error: 'not found' })
          return
        }

        send(res, 405, { error: 'method not allowed' })
      } catch (error) {
        send(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
}
