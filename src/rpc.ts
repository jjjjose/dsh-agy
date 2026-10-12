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
import type { EngineStats } from './stats.ts'
import { executeSearch } from './search.ts'
import { UpdateInputError } from './self-update.ts'
import type { SelfUpdater } from './self-update.ts'

export const ROUTE_PREFIX = '/_dsh/dsh-agy'
const MAX_BODY_BYTES = 64 * 1024

class RpcInputError extends Error {}

function send(res: HttpLikeResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

async function readJsonBody(req: HttpLikeRequest): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  const readable = req as unknown as NodeJS.ReadableStream & { on(event: 'data', cb: (c: Buffer) => void): void; on(event: 'end', cb: () => void): void }
  await new Promise<void>((resolve, reject) => {
    readable.on('error', reject)
    readable.on('aborted', () => reject(new Error('Request aborted')))
    readable.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) chunks.push(chunk)
    })
    readable.on('end', () => resolve())
  })
  if (size > MAX_BODY_BYTES) throw new RpcInputError('Request body too large')
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.length === 0) return {}
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new RpcInputError('Invalid JSON body') }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new RpcInputError('Expected a JSON object')
  return parsed as Record<string, unknown>
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
  options: { refreshModels?: () => void; stats?: EngineStats; updater?: SelfUpdater } = {},
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
        if (!(req.url ?? '').split('?')[0]?.startsWith(`${ROUTE_PREFIX}/`)) {
          send(res, 404, { error: 'not found' })
          return
        }
        const { path, search } = pathOf(req)
        const method = req.method ?? 'GET'

        if (method === 'GET') {
          if (path === '/update/status') {
            if (!options.updater) { send(res, 503, { error: 'Self-updater unavailable' }); return }
            send(res, 200, options.updater.visitSettings())
            return
          }
          if (path === '/stats') {
            send(res, 200, options.stats?.snapshot() ?? { accounts: [] })
            return
          }
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
          if (['/update/check', '/update/install', '/update/config'].includes(path)) {
            if (!options.updater) { send(res, 503, { error: 'Self-updater unavailable' }); return }
            options.updater.visitSettings()
            if (path === '/update/install' && body.confirm !== true) throw new RpcInputError('Explicit confirm: true is required')
            const result = path === '/update/config' ? await options.updater.configure(body)
              : path === '/update/check' ? await options.updater.check() : await options.updater.update()
            send(res, 200, result)
            return
          }
          if (path === '/refresh-models') {
            options.refreshModels?.()
            send(res, 202, { ok: true })
            return
          }
          if (path === '/search') {
            if (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 10000) {
              send(res, 400, { error: 'A non-empty query of at most 10000 characters is required' })
              return
            }
            if (body.urls !== undefined && (!Array.isArray(body.urls) || body.urls.length > 20 || !body.urls.every((url) => typeof url === 'string' && /^https?:\/\//i.test(url)))) {
              send(res, 400, { error: 'urls must contain at most 20 HTTP(S) URLs' })
              return
            }
            const auth = await manager.resolveAuth()
            const report = await executeSearch({ query: body.query, urls: body.urls as string[] | undefined }, auth.token, auth.projectId)
            send(res, 200, { report })
            return
          }
          if (path === '/login') {
            const start = await manager.startLogin()
            send(res, 200, start)
            return
          }
          if (path === '/cancel-login') {
            if (typeof body.loginId !== 'string' || !body.loginId) throw new RpcInputError('loginId is required')
            manager.cancelLogin(body.loginId)
            send(res, 200, { ok: true })
            return
          }
          if (path === '/logout') {
            if (body.accountId !== undefined && (typeof body.accountId !== 'string' || !body.accountId)) throw new RpcInputError('Invalid accountId')
            const accountId = typeof body.accountId === 'string' ? body.accountId : undefined
            await manager.remove(accountId)
            send(res, 200, { ok: true })
            return
          }
          if (path === '/activate') {
            if (typeof body.accountId !== 'string' || !body.accountId) throw new RpcInputError('accountId is required')
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
        const inputError = error instanceof RpcInputError || error instanceof UpdateInputError
        send(res, inputError ? 400 : 500, { error: inputError ? error.message : 'The operation failed. Check account status and try again.' })
      }
    },
  })
}
