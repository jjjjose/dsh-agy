import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CATALOG_REFRESH_MS, ModelCatalog } from '../src/catalog.ts'
import { CatalogController } from '../src/catalog-controller.ts'
import { ModelDiscoveryError, parseModelCatalog, selectedModelEffort, selectModelRoute } from '../src/models.ts'
import type { RequestAuth } from '../src/api.ts'

const directories: string[] = []
const catalogs: ModelCatalog[] = []
async function setup(options: ConstructorParameters<typeof ModelCatalog>[0] = {}) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'dsh-agy-catalog-'))
  directories.push(directory)
  const catalog = new ModelCatalog({ directory, ...options })
  catalogs.push(catalog)
  return { catalog, directory }
}
afterEach(async () => {
  for (const catalog of catalogs.splice(0)) catalog.dispose()
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
  vi.useRealTimers()
})
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
const authA: RequestAuth = { accountId: 'a', projectId: 'project-a', token: 'private-token-a' }
const authB: RequestAuth = { accountId: 'b', projectId: 'project-b', token: 'private-token-b' }
const dataA = parseModelCatalog({ models: { 'gemini-9.1-flash-low': {}, 'gemini-9.1-flash-high': {} } })
const dataB = parseModelCatalog({ models: { 'gemini-9.2-pro-high': {} } })

describe('account-scoped dynamic catalog', () => {
  it('deduplicates requests, caches discovery for 15 minutes and accepts updates', async () => {
    let now = 1000
    const discover = vi.fn().mockResolvedValue(dataA)
    const { catalog } = await setup({ discover, now: () => now })
    await catalog.activate(authA)
    const calls = await Promise.all([catalog.get(authA), catalog.get(authA)])
    expect(discover).toHaveBeenCalledOnce()
    expect(calls[0]).toEqual(calls[1])
    expect(catalog.status()).toMatchObject({ source: 'google', modelCount: 1, variantCount: 2, updatedAt: 1000, refreshing: false })
    await catalog.get(authA)
    expect(discover).toHaveBeenCalledOnce()
    now += CATALOG_REFRESH_MS + 1
    discover.mockResolvedValue(dataB)
    await catalog.get(authA)
    expect(discover).toHaveBeenCalledTimes(2)
    expect(catalog.models()[0]?.id).toBe('gemini-9.2-pro')
  })

  it('persists only sanitized model data and restores routes without tokens', async () => {
    const discover = vi.fn().mockResolvedValue(dataA)
    const { catalog, directory } = await setup({ discover, now: () => 1000 })
    await catalog.activate(authA)
    await catalog.get(authA)
    const files = await fs.readdir(directory)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/)
    const text = await fs.readFile(join(directory, files[0]!), 'utf8')
    expect(text).not.toContain('private-token')
    expect(text).not.toContain('project-a')
    const reloaded = new ModelCatalog({ directory, now: () => 1001, discover })
    catalogs.push(reloaded)
    await reloaded.activate(authA)
    expect(reloaded.status().source).toBe('cache')
    expect((await reloaded.resolve(authA, 'gemini-9.1-flash', 'low')).antigravity.routes.low?.id).toBe('gemini-9.1-flash-low')
    expect((await reloaded.resolve(authA, 'gemini-9.1-flash-high')).antigravity.defaultEffort).toBe('high')
    expect(discover).toHaveBeenCalledOnce()
  })

  it('uses stale cache on network failure, but clears it on authorization failure', async () => {
    const discover = vi.fn().mockResolvedValueOnce(dataA).mockRejectedValueOnce(new Error('network')).mockRejectedValue(new ModelDiscoveryError(403))
    const { catalog, directory } = await setup({ discover })
    await catalog.activate(authA)
    await catalog.get(authA)
    expect(await catalog.get(authA, true)).toEqual(dataA.models)
    expect(catalog.status()).toMatchObject({ source: 'cache', error: expect.any(String) })
    await expect(catalog.get(authA, true)).rejects.toThrow('403')
    expect(catalog.models()).toEqual([])
    expect(await fs.readdir(directory)).toEqual([])
  })

  it('does not resurrect retired models after a valid empty catalog', async () => {
    const discover = vi.fn().mockResolvedValueOnce(dataA).mockResolvedValue({ models: [], ignoredCount: 2 })
    const { catalog } = await setup({ discover })
    await catalog.activate(authA)
    await catalog.get(authA)
    await catalog.get(authA, true)
    expect(catalog.models()).toEqual([])
    expect(catalog.status()).toMatchObject({ source: 'google', modelCount: 0, ignoredCount: 2 })
    await expect(catalog.resolve(authA, 'gemini-9.1-flash')).rejects.toThrow('unavailable')
  })

  it('checks the actual account during routing and rejects unavailable effort', async () => {
    const discover = vi.fn(async (_token: string, project: string) => project === authA.projectId ? dataA : dataB)
    const { catalog } = await setup({ discover })
    await catalog.retain([authA, authB])
    await catalog.activate(authA)
    await catalog.get(authA)
    await expect(catalog.resolve(authB, 'gemini-9.1-flash', 'high')).rejects.toThrow('unavailable for this account')
    await expect(catalog.resolve(authA, 'gemini-9.1-flash', 'medium')).rejects.toThrow('does not offer effort')
    expect(catalog.models()[0]?.id).toBe('gemini-9.1-flash')
  })

  it('preserves the source default across accounts, including the omitted DSH Off', async () => {
    const thinking = parseModelCatalog({ models: { 'claude-sonnet-9-1-thinking': {} } })
    const both = parseModelCatalog({ models: { 'claude-sonnet-9-1': {}, 'claude-sonnet-9-1-thinking': {} } })
    const { catalog } = await setup({ discover: async (_token, project) => project === authA.projectId ? thinking : both })
    const source = thinking.models[0]!
    const resolved = await catalog.resolve(authB, source.id, selectedModelEffort(source))
    expect(resolved.antigravity.defaultEffort).toBe('medium')
    expect(selectModelRoute(resolved).id).toBe('claude-sonnet-9-1-thinking')
    const offSource = both.models[0]!
    await expect(catalog.resolve(authA, offSource.id, selectedModelEffort(offSource))).rejects.toThrow('effort off')
  })

  it('does not publish late responses from a previous account', async () => {
    const pending = deferred<typeof dataA>()
    const started = deferred<void>()
    const discover = vi.fn((_token: string, project: string) => {
      if (project === authA.projectId) { started.resolve(); return pending.promise }
      return Promise.resolve(dataB)
    })
    const { catalog } = await setup({ discover })
    let selected = authA
    const accounts = { catalogIdentity: async () => selected, catalogIdentities: async () => [authA, authB], catalogAuth: async () => selected }
    const controller = new CatalogController(catalog, accounts)
    const first = controller.refresh()
    await started.promise
    selected = authB
    await controller.refresh()
    expect(catalog.models()[0]?.id).toBe('gemini-9.2-pro')
    pending.resolve(dataA)
    await first
    expect(catalog.models()[0]?.id).toBe('gemini-9.2-pro')
    controller.dispose()
  })

  it('invalidates removed accounts and prevents pending responses writing their cache', async () => {
    const pending = deferred<typeof dataA>(), started = deferred<void>()
    const { catalog, directory } = await setup({ discover: async () => { started.resolve(); return pending.promise } })
    await catalog.retain([authA])
    await catalog.activate(authA)
    const request = catalog.get(authA)
    const rejection = expect(request).rejects.toThrow('removed')
    await started.promise
    await catalog.retain([])
    await catalog.activate(undefined)
    pending.resolve(dataA)
    await rejection
    expect(catalog.models()).toEqual([])
    expect(await fs.readdir(directory).catch(() => [])).toEqual([])
    await expect(catalog.get(authA)).rejects.toThrow('unavailable')
  })

  it('expires fallback after 24 hours and ignores invalid cache', async () => {
    let now = 1000
    const discover = vi.fn().mockResolvedValueOnce(dataA).mockRejectedValue(new Error('network'))
    const { catalog, directory } = await setup({ discover, now: () => now })
    await catalog.activate(authA)
    await catalog.get(authA)
    now += 24 * 60 * 60_000 + 1
    await expect(catalog.get(authA, true)).rejects.toThrow('network')
    expect(catalog.models()).toEqual([])
    const reloaded = new ModelCatalog({ directory, now: () => now, discover })
    catalogs.push(reloaded)
    await reloaded.activate(authA)
    expect(reloaded.models()).toEqual([])
    const file = (await fs.readdir(directory))[0]!
    await fs.writeFile(join(directory, file), 'not JSON')
    const invalid = new ModelCatalog({ directory })
    catalogs.push(invalid)
    await invalid.activate(authA)
    expect(invalid.status().source).toBe('unavailable')
  })

  it('preserves same-route confirmed limits only until their original verification expires', async () => {
    let now = 1000
    const confirmed = parseModelCatalog({ models: { 'gemini-3.8-flash-high': { maxTokens: 1048576, maxOutputTokens: 65536 } } })
    const missing = parseModelCatalog({ models: { 'gemini-3.8-flash-high': {} } })
    const discover = vi.fn().mockResolvedValueOnce(confirmed).mockResolvedValue(missing)
    const { catalog } = await setup({ discover, now: () => now })
    await catalog.activate(authA)
    await catalog.get(authA)
    now += 60000
    await catalog.get(authA, true)
    expect(catalog.status().models[0]?.contextWindow).toEqual({ value: 1048576, source: 'cache', verifiedAt: 1000 })
    const route = await catalog.resolve(authA, 'gemini-3.8-flash', 'high')
    expect(route).toMatchObject({ contextWindow: 1048576, maxTokens: 65536 })
    now += 24 * 60 * 60_000
    await catalog.get(authA, true)
    expect(catalog.status().models[0]?.contextWindow).toEqual({ value: 32768, source: 'fallback' })
  })

  it('invalidates cache v1 rather than advertising its synthesized 32k limits', async () => {
    const { catalog, directory } = await setup({ discover: async () => dataA, now: () => 1000 })
    await catalog.get(authA)
    const file = (await fs.readdir(directory))[0]!
    await fs.writeFile(join(directory, file), JSON.stringify({ version: 1, updatedAt: 1000,
      catalog: { models: { 'gemini-3.8-flash-high': { contextWindow: 32768, maxOutputTokens: 8192 } } } }))
    const fresh = new ModelCatalog({ directory, now: () => 1001 })
    catalogs.push(fresh)
    await fresh.activate(authA)
    expect(fresh.models()).toEqual([])
  })

  it('restores v2 confirmed and unknown limits with their provenance and route-specific values', async () => {
    const data = parseModelCatalog({ models: { 'gemini-3.8-flash-high': { maxTokens: 1048576, maxOutputTokens: 65536 }, 'gemini-3.8-flash-low': {} } })
    const { catalog, directory } = await setup({ discover: async () => data, now: () => 1000 })
    await catalog.get(authA)
    const fresh = new ModelCatalog({ directory, now: () => 1001 })
    catalogs.push(fresh)
    await fresh.activate(authA)
    expect(fresh.status().models[0]?.contextWindow).toEqual({ value: 1048576, source: 'cache', verifiedAt: 1000 })
    expect((await fresh.resolve(authA, 'gemini-3.8-flash', 'low')).contextWindow).toBe(32768)
    expect((await fresh.resolve(authA, 'gemini-3.8-flash', 'high')).contextWindow).toBe(1048576)
    expect(fresh.status().models[0]?.variants.find((variant) => variant.effort === 'low')?.capabilities.contextWindow.source).toBe('fallback')
  })

  it('cancels one caller without aborting a shared refresh, and disposal aborts discovery', async () => {
    const started = deferred<void>(), pending = deferred<typeof dataA>()
    let signal!: AbortSignal
    const { catalog } = await setup({ discover: async (_token, _project, current) => { signal = current!; started.resolve(); return pending.promise } })
    const caller = new AbortController()
    const request = catalog.get(authA, false, caller.signal)
    const rejection = expect(request).rejects.toThrow('caller cancelled')
    await started.promise
    caller.abort(new Error('caller cancelled'))
    await rejection
    expect(signal.aborted).toBe(false)
    const shared = catalog.get(authA)
    const disposed = expect(shared).rejects.toThrow()
    catalog.dispose()
    await disposed
    expect(signal.aborted).toBe(true)
    pending.resolve(dataA)
  })

  it('refreshes every 15 minutes and stops its scheduler on disposal', async () => {
    vi.useFakeTimers()
    const accounts = { catalogIdentity: vi.fn().mockResolvedValue(undefined), catalogIdentities: async () => [], catalogAuth: vi.fn() }
    const { catalog } = await setup()
    const controller = new CatalogController(catalog, accounts)
    controller.start()
    controller.start()
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_MS)
    expect(accounts.catalogIdentity).toHaveBeenCalledTimes(2)
    controller.dispose()
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_MS)
    expect(accounts.catalogIdentity).toHaveBeenCalledTimes(2)
  })
})
