import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearPool, loadPool, poolPath, sanitizeAccount, savePool, stateDir } from '../src/storage.ts'
import type { Account } from '../src/types.ts'

let home: string
const originalHome = process.env.DSH_HOME

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-agy-'))
  process.env.DSH_HOME = home
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

function sampleAccount(id: string): Account {
  return { id, refreshToken: `r-${id}`, projectId: 'p', addedAt: 1, lastUsed: 2, enabled: true }
}

describe('state paths', () => {
  it('derives the pool path from DSH_HOME', () => {
    expect(stateDir()).toBe(join(home, 'dsh-agy'))
    expect(poolPath()).toBe(join(home, 'dsh-agy', 'accounts.json'))
  })
})

describe('sanitizeAccount', () => {
  it('accepts a valid account and defaults enabled', () => {
    const a = sanitizeAccount({ id: 'x', refreshToken: 'r', projectId: 'p' })
    expect(a?.id).toBe('x')
    expect(a?.enabled).toBe(true)
  })

  it('rejects accounts missing required fields', () => {
    expect(sanitizeAccount({ id: 'x' })).toBeUndefined()
    expect(sanitizeAccount({ refreshToken: 'r', projectId: 'p' })).toBeUndefined()
    expect(sanitizeAccount(null)).toBeUndefined()
    expect(sanitizeAccount('nope')).toBeUndefined()
  })

  it('drops malformed rate limits and fingerprints', () => {
    const a = sanitizeAccount({ id: 'x', refreshToken: 'r', projectId: 'p', rateLimitedUntil: { all: 'soon' }, fingerprint: { deviceId: 1 } })
    expect(a?.rateLimitedUntil).toBeUndefined()
    expect(a?.fingerprint).toBeUndefined()
  })
})

describe('loadPool / savePool / clearPool', () => {
  it('snapshots queued writes before caller mutation', async () => {
    const storage = { version: 1 as const, accounts: [sampleAccount('snapshot')] }
    const pending = savePool(storage)
    storage.accounts[0]!.refreshToken = 'mutated'
    await pending
    expect((await loadPool()).accounts[0]?.refreshToken).toBe('r-snapshot')
  })

  it('orders concurrent saves and clear operations', async () => {
    await Promise.all([
      savePool({ version: 1, accounts: [sampleAccount('first')] }),
      clearPool(),
      savePool({ version: 1, accounts: [sampleAccount('last')] }),
    ])
    expect((await loadPool()).accounts.map((a) => a.id)).toEqual(['last'])
  })
  it('returns an empty pool when the file is missing', async () => {
    const pool = await loadPool()
    expect(pool).toEqual({ version: 1, accounts: [] })
  })

  it('round-trips accounts and the active id', async () => {
    await savePool({ version: 1, accounts: [sampleAccount('a'), sampleAccount('b')], activeId: 'b' })
    const pool = await loadPool()
    expect(pool.accounts.map((a) => a.id)).toEqual(['a', 'b'])
    expect(pool.activeId).toBe('b')
  })

  it('clamps activeId to a real account', async () => {
    await savePool({ version: 1, accounts: [sampleAccount('a')], activeId: 'ghost' })
    const pool = await loadPool()
    expect(pool.activeId).toBe('a')
  })

  it('returns empty on a malformed file', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(stateDir(), { recursive: true })
    await writeFile(poolPath(), '{ not json', 'utf8')
    expect(await loadPool()).toEqual({ version: 1, accounts: [] })
  })

  it('clears the pool', async () => {
    await savePool({ version: 1, accounts: [sampleAccount('a')], activeId: 'a' })
    await clearPool()
    expect(await loadPool()).toEqual({ version: 1, accounts: [] })
  })
})
