/**
 * Persistent multi-account pool stored under the Harness home directory.
 * Writes are atomic (temp file + rename) and serialized with an in-process
 * mutex so concurrent tool/host calls cannot interleave partial writes.
 * Validation is hand-rolled to keep the plugin dependency-light.
 */

import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Account, AccountStorage, Fingerprint } from './types.ts'

/** Directory that owns this plugin's state files. */
export function stateDir(): string {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'dsh-agy')
}

/** Absolute path of the account pool file. */
export function poolPath(): string {
  return join(stateDir(), 'accounts.json')
}

function emptyStorage(): AccountStorage {
  return { version: 1, accounts: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sanitizeFingerprint(value: unknown): Fingerprint | undefined {
  if (!isRecord(value)) return undefined
  const deviceId = str(value.deviceId)
  const userAgent = str(value.userAgent)
  if (deviceId === undefined || userAgent === undefined) return undefined
  return { deviceId, userAgent }
}

function sanitizeRateLimits(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) {
    const t = num(entry)
    if (t !== undefined) out[key] = t
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Coerce one raw record into a valid Account, or undefined when unusable. */
export function sanitizeAccount(value: unknown): Account | undefined {
  if (!isRecord(value)) return undefined
  const id = str(value.id)
  const refreshToken = str(value.refreshToken)
  const projectId = str(value.projectId)
  if (id === undefined || refreshToken === undefined || projectId === undefined) return undefined
  const fingerprint = sanitizeFingerprint(value.fingerprint)
  const rateLimitedUntil = sanitizeRateLimits(value.rateLimitedUntil)
  return {
    id,
    ...str(value.email) === undefined ? {} : { email: str(value.email) },
    refreshToken,
    projectId,
    addedAt: num(value.addedAt) ?? 0,
    lastUsed: num(value.lastUsed) ?? 0,
    ...str(value.accessToken) === undefined ? {} : { accessToken: str(value.accessToken) },
    ...num(value.accessExpires) === undefined ? {} : { accessExpires: num(value.accessExpires) },
    ...fingerprint === undefined ? {} : { fingerprint },
    ...rateLimitedUntil === undefined ? {} : { rateLimitedUntil },
    ...num(value.coolingDownUntil) === undefined ? {} : { coolingDownUntil: num(value.coolingDownUntil) },
    enabled: value.enabled !== false,
  }
}

// Serialize writes within this process to avoid lost updates.
let writeChain: Promise<unknown> = Promise.resolve()
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn)
  writeChain = run.catch(() => undefined)
  return run
}

/** Load the account pool, tolerating a missing or malformed file. */
export async function loadPool(): Promise<AccountStorage> {
  try {
    const content = await fs.readFile(poolPath(), 'utf8')
    const parsed: unknown = JSON.parse(content)
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.accounts)) return emptyStorage()
    const accounts = parsed.accounts.map(sanitizeAccount).filter((a): a is Account => a !== undefined)
    const activeId = typeof parsed.activeId === 'string' && accounts.some((a) => a.id === parsed.activeId)
      ? parsed.activeId
      : accounts[0]?.id
    return { version: 1, accounts, ...activeId === undefined ? {} : { activeId } }
  } catch {
    return emptyStorage()
  }
}

/** Persist the pool atomically. */
export function savePool(storage: AccountStorage): Promise<void> {
  const content = JSON.stringify(storage, null, 2)
  const target = poolPath()
  const dir = stateDir()
  return withLock(async () => {
    await fs.mkdir(dir, { recursive: true })
    const tmp = `${target}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(tmp, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await fs.rename(tmp, target)
    } finally {
      await fs.unlink(tmp).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
    }
  })
}

/** Remove the pool file entirely (used by "disconnect all"). */
export async function clearPool(): Promise<void> {
  const target = poolPath()
  await withLock(async () => {
    try {
      await fs.unlink(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  })
}

export type { Account, AccountStorage }
