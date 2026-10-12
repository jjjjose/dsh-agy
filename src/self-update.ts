/** Configurable package self-update. Defaults to no source and no network activity. */
import { randomUUID } from 'node:crypto'
import { promises as fs, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { stateDir } from './storage.ts'
import { extractUpdate, installUpdate } from './update-payload.ts'

export const DEFAULT_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000
export interface UpdateConfig { enabled: boolean; intervalMs: number; registryOrigin: string }
export interface UpdateStatus extends UpdateConfig {
  runningVersion: string
  diskVersion: string
  latest: string | null
  available: boolean
  pendingRestart: boolean
  configured: boolean
  installAllowed: boolean
  pausedForSettings: boolean
  lastCheckAt: number | null
  lastError: string | null
}
export class UpdateInputError extends Error {}

export function validateUpdateConfig(value: Record<string, unknown>, base: UpdateConfig): UpdateConfig {
  if (Object.keys(value).some((key) => !['enabled', 'intervalMs', 'registryOrigin'].includes(key))) throw new UpdateInputError('Unknown update option')
  const next = { ...base, ...value }
  if (typeof next.enabled !== 'boolean') throw new UpdateInputError('enabled must be boolean')
  if (typeof next.intervalMs !== 'number' || !Number.isInteger(next.intervalMs) || next.intervalMs < 60000 || next.intervalMs > 7 * 86400000) throw new UpdateInputError('intervalMs must be between 60000 and 604800000')
  if (typeof next.registryOrigin !== 'string') throw new UpdateInputError('registryOrigin must be a string')
  if (next.registryOrigin) {
    let url: URL
    try { url = new URL(next.registryOrigin) } catch { throw new UpdateInputError('Invalid registry origin') }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new UpdateInputError('Use an HTTPS registry origin without credentials, path, query or fragment')
    next.registryOrigin = url.origin
  }
  return next as UpdateConfig
}

function versionParts(value: unknown): number[] {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw new Error('invalid-version')
  const parts = value.split('.').map(Number)
  if (!parts.every(Number.isSafeInteger)) throw new Error('invalid-version')
  return parts
}
function newer(left: string, right: string): boolean {
  const a = versionParts(left), b = versionParts(right)
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index]! > b[index]!
  return false
}
function manifest(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
}
function profileInstall(root: string): boolean {
  try {
    const actual = realpathSync(root)
    const profiles = realpathSync(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles')) + sep
    return process.platform === 'linux' ? actual.startsWith(profiles) : actual.toLowerCase().startsWith(profiles.toLowerCase())
  } catch { return false }
}

export function createSelfUpdater(options: {
  config?: Partial<UpdateConfig>
  packageDir?: string
  dataDir?: string
  fetch?: typeof fetch
  installAllowed?: boolean
  install?: typeof installUpdate
  now?: () => number
} = {}) {
  // esbuild host output is lib/index.js; sources live directly under src/.
  const root = options.packageDir ?? dirname(dirname(fileURLToPath(import.meta.url)))
  const dataDir = options.dataDir ?? stateDir()
  const stateFile = join(dataDir, 'update-config.json')
  const current = manifest(root)
  if (current.name !== 'dsh-agy') throw new Error('identity-mismatch')
  const runningVersion = String(current.version)
  versionParts(runningVersion)
  let config = validateUpdateConfig(options.config ?? {}, { enabled: false, intervalMs: DEFAULT_UPDATE_INTERVAL_MS, registryOrigin: '' })
  try { config = validateUpdateConfig(JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, unknown>, config) } catch { /* Missing/invalid state: deployment defaults, no writes. */ }
  const allowed = options.installAllowed ?? profileInstall(root)
  const fetchImpl = options.fetch ?? fetch
  const now = options.now ?? Date.now
  let latest: string | null = null
  let lastCheckAt: number | null = null
  let lastError: string | null = null
  let pageVisited = false
  let disposed = false
  let revision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let checkPending: Promise<UpdateStatus> | undefined
  let installPending: Promise<UpdateStatus> | undefined
  let configPending = Promise.resolve()
  const controllers = new Set<AbortController>()

  function status(): UpdateStatus {
    let diskVersion = runningVersion
    try { diskVersion = String(manifest(root).version); versionParts(diskVersion) } catch { lastError = 'disk-version-unavailable' }
    return { ...config, runningVersion, diskVersion, latest, available: latest !== null && newer(latest, diskVersion), pendingRestart: diskVersion !== runningVersion, configured: !!config.registryOrigin, installAllowed: allowed, pausedForSettings: pageVisited, lastCheckAt, lastError }
  }
  async function download(url: string, limit: number): Promise<Buffer> {
    const controller = new AbortController()
    controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), 60000)
    try {
      const response = await fetchImpl(url, { redirect: 'error', signal: controller.signal, headers: { accept: '*/*' } })
      if (!response.ok || !response.body) throw new Error('download-failed')
      const reader = response.body.getReader()
      const chunks: Buffer[] = []
      let size = 0
      try {
        while (true) {
          const result = await reader.read()
          if (result.done) break
          size += result.value.byteLength
          if (size > limit) throw new Error('download-too-large')
          chunks.push(Buffer.from(result.value))
        }
      } finally { await reader.cancel() }
      return Buffer.concat(chunks)
    } finally { clearTimeout(timeout); controllers.delete(controller) }
  }
  async function release() {
    if (!config.registryOrigin) throw new Error('source-not-configured')
    const body = JSON.parse((await download(`${config.registryOrigin}/dsh-agy/latest`, 1024 * 1024)).toString('utf8')) as { name?: unknown; version?: unknown; dist?: { integrity?: unknown; tarball?: unknown } }
    versionParts(body.version)
    if (body.name !== 'dsh-agy' || typeof body.dist?.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(body.dist.integrity) || typeof body.dist.tarball !== 'string') throw new Error('invalid-release')
    const url = new URL(body.dist.tarball)
    if (url.origin !== config.registryOrigin || url.username || url.password || url.hash || url.search) throw new Error('unsafe-download-origin')
    return { version: body.version as string, integrity: body.dist.integrity, url: url.href }
  }
  async function run(install: boolean, manual: boolean): Promise<UpdateStatus> {
    const started = revision
    try {
      if (disposed) throw new Error('updater-disposed')
      if (install && !allowed) throw new Error('profile-install-required')
      const target = await release()
      if (started !== revision || disposed) return status()
      latest = target.version; lastCheckAt = now(); lastError = null
      if (!install || !status().available) return status()
      if (!manual && (!config.enabled || pageVisited)) return status()
      const archive = await download(target.url, 8 * 1024 * 1024)
      const files = extractUpdate(archive, target.integrity, target.version)
      const next = JSON.parse(files.find((file) => file.path === 'package.json')!.data.toString('utf8')) as Record<string, unknown>
      // Package-only replacement cannot install new dependencies or run npm scripts.
      for (const key of ['dependencies', 'peerDependencies']) if (JSON.stringify(next[key]) !== JSON.stringify(current[key])) throw new Error('dependency-change-requires-manual-install')
      if (disposed || started !== revision || (!manual && (!config.enabled || pageVisited))) return status()
      await (options.install ?? installUpdate)(root, dataDir, files)
    } catch (error) {
      if (!disposed && started === revision) {
        lastCheckAt = now()
        const message = error instanceof Error ? error.message : ''
        lastError = /^[a-z]+(?:-[a-z]+)+$/.test(message) ? message : 'update-failed'
      }
    }
    return status()
  }
  function check(): Promise<UpdateStatus> {
    checkPending ??= run(false, true).finally(() => { checkPending = undefined })
    return checkPending
  }
  function update(manual = true): Promise<UpdateStatus> {
    if (!manual && (!config.enabled || !config.registryOrigin || pageVisited || !allowed || disposed)) return Promise.resolve(status())
    installPending ??= run(true, manual).finally(() => { installPending = undefined })
    return installPending
  }
  function schedule(): void {
    clearTimeout(timer)
    if (disposed || !config.enabled || !config.registryOrigin || !allowed || pageVisited) return
    timer = setTimeout(() => { void update(false).finally(schedule) }, config.intervalMs)
    timer.unref?.()
  }
  return {
    status,
    visitSettings() { pageVisited = true; schedule(); return status() },
    check,
    update,
    configure(value: Record<string, unknown>): Promise<UpdateStatus> {
      const pending = configPending.then(async () => {
        if (disposed) throw new Error('updater-disposed')
        const next = validateUpdateConfig(value, config)
        await fs.mkdir(dataDir, { recursive: true, mode: 0o700 })
        const temp = `${stateFile}.${randomUUID()}.tmp`
        try { await fs.writeFile(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await fs.rename(temp, stateFile) }
        finally { await fs.rm(temp, { force: true }) }
        config = next; revision++; latest = null; lastError = null; schedule()
        return status()
      })
      configPending = pending.then(() => undefined, () => undefined)
      return pending
    },
    start() { schedule() },
    dispose() { disposed = true; clearTimeout(timer); for (const controller of controllers) controller.abort() },
  }
}

export type SelfUpdater = ReturnType<typeof createSelfUpdater>
