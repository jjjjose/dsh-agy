/** Per-account live catalogs, bounded disk fallback and immutable model snapshots. */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { ModelThinkingLevel as ThinkingLevel } from '@earendil-works/pi-ai'
import { discoverModelCatalog, ModelDiscoveryError, ModelSelectionError, modelLimits, parseModelCatalog, retainModelCapabilities, selectModelRoute, withLegacyAliases } from './models.ts'
import type { CatalogStatus, DynamicModel } from './models.ts'
import type { RequestAuth } from './api.ts'
import type { DiagnosticRecord } from './diagnostics-format.ts'
import { stateDir } from './storage.ts'

export const CATALOG_REFRESH_MS = 15 * 60_000
const MAX_CACHE_AGE = 24 * 60 * 60_000
const EMPTY_MODELS: readonly DynamicModel[] = Object.freeze([])
export interface CatalogIdentity { accountId: string; projectId: string }
interface Snapshot { models: DynamicModel[]; ignoredCount: number; updatedAt: number; source: 'google' | 'cache'; error?: string }
const keyOf = (identity: CatalogIdentity): string => createHash('sha256').update(JSON.stringify([identity.accountId, identity.projectId])).digest('hex')

function waitFor<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export class ModelCatalog {
  private readonly snapshots = new Map<string, Snapshot>()
  private readonly pending = new Map<string, Promise<Snapshot>>()
  private readonly loading = new Map<string, Promise<void>>()
  private readonly lifetime = new AbortController()
  private activeKey?: string
  private activeRevision = 0
  private activeError?: string
  private allowed?: Set<string>
  private readonly directory: string
  private readonly now: () => number

  constructor(private readonly options: {
    directory?: string
    now?: () => number
    discover?: typeof discoverModelCatalog
    changed?: () => void
    log?: (entry: DiagnosticRecord) => void
  } = {}) {
    this.directory = options.directory ?? join(stateDir(), 'model-catalogs')
    this.now = options.now ?? Date.now
  }

  private log(event: DiagnosticRecord['event'], modelCount = 0, requestId = 'catalog', status?: number): void {
    try { this.options.log?.({ requestId, model: 'catalog', event, modelCount, status }) } catch { /* Best effort only. */ }
  }
  private changed(): void { if (!this.lifetime.signal.aborted) this.options.changed?.() }

  async activate(identity?: CatalogIdentity): Promise<void> {
    const revision = ++this.activeRevision
    this.activeKey = identity ? keyOf(identity) : undefined
    this.activeError = undefined
    this.changed() // Never expose the previous account's models during refresh.
    if (identity) await this.loadCache(keyOf(identity))
    if (revision === this.activeRevision) this.changed()
  }

  models(): readonly DynamicModel[] { return this.activeKey ? this.snapshots.get(this.activeKey)?.models ?? EMPTY_MODELS : EMPTY_MODELS }

  status(): CatalogStatus {
    const current = this.activeKey ? this.snapshots.get(this.activeKey) : undefined
    return { source: current?.source ?? 'unavailable', updatedAt: current?.updatedAt ?? null,
      modelCount: current?.models.length ?? 0,
      variantCount: current ? current.models.reduce((count, model) => count + Object.keys(model.antigravity.routes).length, 0) : 0,
      ignoredCount: current?.ignoredCount ?? 0, refreshing: this.activeKey ? this.pending.has(this.activeKey) : false,
      error: this.activeError ?? current?.error,
      models: (current?.models ?? []).map((model) => ({ id: model.id, name: model.name, ...modelLimits(model),
        variants: Object.entries(model.antigravity.routes).map(([effort, route]) => ({ effort, id: route.id, capabilities: route.capabilities! })) })) }
  }

  failure(): void { this.activeError = 'No se pudo actualizar el catálogo. Comprueba la cuenta y la conexión.'; this.changed() }

  async get(auth: RequestAuth, force = false, signal?: AbortSignal): Promise<readonly DynamicModel[]> {
    this.lifetime.signal.throwIfAborted()
    const key = keyOf(auth)
    if (this.allowed && !this.allowed.has(key)) throw new Error('Antigravity catalog account is unavailable')
    await waitFor(this.loadCache(key), signal)
    this.lifetime.signal.throwIfAborted()
    signal?.throwIfAborted()
    if (this.allowed && !this.allowed.has(key)) throw new Error('Antigravity catalog account is unavailable')
    const current = this.snapshots.get(key)
    if (!force && current && this.now() - current.updatedAt < CATALOG_REFRESH_MS) return current.models
    let operation = this.pending.get(key)
    if (!operation) {
      operation = this.fetch(key, auth)
      this.pending.set(key, operation)
      this.changed()
      void operation.finally(() => { this.pending.delete(key); this.changed() }).catch(() => undefined)
    }
    return (await waitFor(operation, signal)).models
  }

  async resolve(auth: RequestAuth, selectedId: string, effort?: ThinkingLevel | 'default', signal?: AbortSignal): Promise<DynamicModel> {
    const models = await this.get(auth, false, signal)
    const selected = withLegacyAliases(models).find((model) => model.id === selectedId)
    if (!selected) throw new ModelSelectionError(`Antigravity model ${selectedId} is unavailable for this account. Refresh models and select an available model.`)
    const requested = effort ?? selected.antigravity.defaultEffort
    if (!selected.antigravity.routes[requested]) throw new ModelSelectionError(`Antigravity model ${selectedId} does not offer effort ${requested} for this account.`)
    const route = selectModelRoute(selected, requested)
    // Freeze the initially selected default across account rotation. Otherwise a
    // DSH Off (omitted reasoning) could turn into another account's Medium.
    return { ...selected, contextWindow: route.capabilities?.contextWindow.value ?? selected.contextWindow,
      maxTokens: route.capabilities?.maxOutputTokens.value ?? selected.maxTokens,
      input: route.capabilities?.supportsImages === true ? ['text', 'image'] : ['text'],
      antigravity: { ...selected.antigravity, defaultEffort: requested } }
  }

  async retain(identities: readonly CatalogIdentity[]): Promise<void> {
    const keys = new Set(identities.map(keyOf))
    this.allowed = keys
    for (const key of this.snapshots.keys()) if (!keys.has(key)) this.snapshots.delete(key)
    // Only delete this component's hash-named cache files, never account files.
    const files = await fs.readdir(this.directory).catch(() => [] as string[])
    for (const file of files) if (/^[a-f0-9]{64}\.json$/.test(file) && !this.allowed.has(file.slice(0, -5))) await fs.unlink(join(this.directory, file)).catch(() => undefined)
    this.changed()
  }

  dispose(): void { this.lifetime.abort(); this.snapshots.clear() }

  private loadCache(key: string): Promise<void> {
    let operation = this.loading.get(key)
    if (!operation) {
      operation = (async () => {
        if (this.snapshots.has(key)) return
        try {
          const text = await fs.readFile(join(this.directory, `${key}.json`), 'utf8')
          if (text.length > 1_000_000) return
          const stored = JSON.parse(text) as { version?: unknown; updatedAt?: unknown; catalog?: unknown; ignoredCount?: unknown }
          if (stored.version !== 2 || typeof stored.updatedAt !== 'number' || !Number.isSafeInteger(stored.updatedAt)
            || stored.updatedAt < 0 || stored.updatedAt > this.now() || this.now() - stored.updatedAt > MAX_CACHE_AGE) return
          const parsed = parseModelCatalog(stored.catalog, 'cache', this.now())
          this.lifetime.signal.throwIfAborted()
          if (this.allowed && !this.allowed.has(key)) return
          this.snapshots.set(key, { ...parsed, ignoredCount: typeof stored.ignoredCount === 'number' && Number.isSafeInteger(stored.ignoredCount) && stored.ignoredCount >= 0 ? stored.ignoredCount : parsed.ignoredCount,
            updatedAt: stored.updatedAt, source: 'cache' })
        } catch { /* Missing, stale or invalid cache is not an advertised catalog. */ }
      })()
      this.loading.set(key, operation)
    }
    return operation
  }

  private async fetch(key: string, auth: RequestAuth): Promise<Snapshot> {
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), 30_000)
    const signal = AbortSignal.any([this.lifetime.signal, timeout.signal])
    const requestId = `catalog-${randomUUID()}`
    this.log('catalog-refresh', 0, requestId)
    try {
      const discovered = await waitFor((this.options.discover ?? discoverModelCatalog)(auth.token, auth.projectId, signal), signal)
      signal.throwIfAborted()
      if (this.allowed && !this.allowed.has(key)) throw new Error('Antigravity catalog account was removed')
      const snapshot: Snapshot = { ...discovered,
        models: retainModelCapabilities(discovered.models, this.snapshots.get(key)?.models ?? [], this.now()),
        updatedAt: this.now(), source: 'google' }
      this.snapshots.set(key, snapshot)
      if (key === this.activeKey) this.activeError = undefined
      // Store a reconstructed allowlist, never Google's raw response/quota data.
      const models: Record<string, Record<string, unknown>> = {}
      for (const model of snapshot.models) for (const [effort, route] of Object.entries(model.antigravity.routes)) {
        const entry = models[route.id] ?? { displayName: model.name, capabilities: route.capabilities,
          supportsImages: route.capabilities?.supportsImages, supportsVideo: route.capabilities?.supportsVideo,
          thinkingBudget: route.thinking?.thinkingBudget,
          supportsThinking: route.thinking !== undefined, supportedThinkingLevels: [] as string[] }
        if (effort !== 'default') (entry.supportedThinkingLevels as string[]).push(effort)
        models[route.id] = entry
      }
      const aliases = Object.fromEntries(snapshot.models.map((model) => [model.id, model.antigravity.aliases]))
      await this.save(key, { version: 2, updatedAt: snapshot.updatedAt, catalog: { models, aliases }, ignoredCount: snapshot.ignoredCount }).catch(() => this.log('catalog-cache-write-error', 0, requestId))
      if (this.allowed && !this.allowed.has(key)) {
        this.snapshots.delete(key)
        await fs.unlink(join(this.directory, `${key}.json`)).catch(() => undefined)
        throw new Error('Antigravity catalog account was removed')
      }
      this.log('catalog-updated', snapshot.models.length, requestId)
      return snapshot
    } catch (error) {
      this.lifetime.signal.throwIfAborted()
      this.log('catalog-error', 0, requestId, error instanceof ModelDiscoveryError ? error.status : undefined)
      if (error instanceof ModelDiscoveryError && [401, 403].includes(error.status)) {
        this.snapshots.delete(key)
        await fs.unlink(join(this.directory, `${key}.json`)).catch(() => undefined)
        throw error
      }
      const previous = this.snapshots.get(key)
      if (previous && this.now() - previous.updatedAt <= MAX_CACHE_AGE) {
        const fallback: Snapshot = { ...previous, source: 'cache', error: 'No se pudo contactar con Google; se utiliza el último catálogo válido.' }
        this.snapshots.set(key, fallback)
        this.log('catalog-cache', fallback.models.length, requestId)
        return fallback
      }
      this.snapshots.delete(key)
      throw error
    } finally { clearTimeout(timer) }
  }

  private async save(key: string, value: unknown): Promise<void> {
    const destination = join(this.directory, `${key}.json`)
    const temporary = `${destination}.${randomUUID()}.tmp`
    try {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
      await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
      await fs.rename(temporary, destination)
    } catch (error) { await fs.unlink(temporary).catch(() => undefined); throw error }
  }
}
