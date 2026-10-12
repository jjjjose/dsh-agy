import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagerOptions } from '../src/manager.ts'
import type { Account } from '../src/types.ts'

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), clear: vi.fn(), refresh: vi.fn(), config: vi.fn() }))
vi.mock('../src/storage.ts', () => ({ loadPool: mocks.load, savePool: mocks.save, clearPool: mocks.clear }))
vi.mock('../src/token.ts', () => ({ refreshAccountAccess: mocks.refresh }))
vi.mock('../src/client-config.ts', () => ({ DEFAULT_OAUTH_CLIENT_CONFIG_REF: 'config', resolveOAuthClientConfig: mocks.config }))
import { AccountManager } from '../src/manager.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function account(): Account {
  return { id: 'test-account', refreshToken: 'test-refresh', projectId: 'test-project', enabled: true, addedAt: 0, lastUsed: 0 }
}

function manager(login = vi.fn()) {
  const unset = vi.fn().mockResolvedValue(undefined)
  const options = {
    oauth: { login }, credentials: { set: vi.fn().mockResolvedValue(undefined), unset }, credentialRef: 'test-ref', maxWaitMs: 0,
  } as unknown as ManagerOptions
  return { instance: new AccountManager(options), unset }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.load.mockResolvedValue({ version: 1, accounts: [account()], activeId: 'test-account' })
  mocks.save.mockResolvedValue(undefined)
  mocks.config.mockResolvedValue({ clientId: 'test-client', clientSecret: 'test-secret' })
})

describe('AccountManager concurrency and eligibility', () => {
  it('loads the pool once for simultaneous callers', async () => {
    const pending = deferred<{ version: number; accounts: Account[] }>()
    mocks.load.mockReturnValue(pending.promise)
    const { instance } = manager()
    const calls = [instance.init(), instance.init(), instance.list()]
    expect(mocks.load).toHaveBeenCalledTimes(1)
    pending.resolve({ version: 1, accounts: [account()] })
    await Promise.all(calls)
  })

  it('shares token refresh across simultaneous requests', async () => {
    const pending = deferred<{ kind: 'ok'; access: string; expires: number }>()
    mocks.refresh.mockReturnValue(pending.promise)
    const { instance } = manager()
    const calls = [instance.resolveAuth(), instance.resolveAuth()]
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))
    pending.resolve({ kind: 'ok', access: 'test-access', expires: Date.now() + 3600_000 })
    expect((await Promise.all(calls)).map((a) => a.token)).toEqual(['test-access', 'test-access'])
  })

  it.each(['disabled', 'limited', 'cooldown'])('never falls back to a %s account', async (kind) => {
    const a = account()
    if (kind === 'disabled') a.enabled = false
    if (kind === 'limited') a.rateLimitedUntil = { all: Date.now() + 60_000 }
    if (kind === 'cooldown') a.coolingDownUntil = Date.now() + 60_000
    mocks.load.mockResolvedValue({ version: 1, accounts: [a] })
    const { instance } = manager()
    await expect(instance.resolveAuth()).rejects.toThrow('No usable')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('disables a revoked account and removes its mirrored credentials', async () => {
    mocks.refresh.mockResolvedValue({ kind: 'revoked' })
    const { instance, unset } = manager()
    await expect(instance.resolveAuth()).rejects.toThrow('revoked')
    expect(unset).toHaveBeenCalledOnce()
    expect((await instance.list())[0]?.enabled).toBe(false)
  })

  it('accepts a short rate-limit delay and never shortens an existing limit', async () => {
    const { instance } = manager()
    await instance.init()
    instance.reportRateLimit('test-account', 100)
    const first = mocks.save.mock.calls.at(-1)![0].accounts[0].rateLimitedUntil.all as number
    instance.reportRateLimit('test-account', 0)
    expect(mocks.save.mock.calls.at(-1)![0].accounts[0].rateLimitedUntil.all).toBe(first)
    await expect(instance.resolveAuth()).rejects.toThrow('No usable')
  })

  it('aborts in-flight refresh when disposed', async () => {
    const pending = deferred<{ kind: 'ok'; access: string; expires: number }>()
    mocks.refresh.mockReturnValue(pending.promise)
    const { instance } = manager()
    const request = instance.resolveAuth()
    const rejected = expect(request).rejects.toThrow()
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    const signal = mocks.refresh.mock.calls[0]![2] as AbortSignal
    instance.dispose()
    expect(signal.aborted).toBe(true)
    pending.resolve({ kind: 'ok', access: 'test-access', expires: Date.now() + 3600_000 })
    await rejected
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('does not resurrect a removed account after refresh finishes', async () => {
    const pending = deferred<{ kind: 'ok'; access: string; expires: number }>()
    mocks.refresh.mockReturnValue(pending.promise)
    const { instance } = manager()
    const request = instance.resolveAuth()
    const rejected = expect(request).rejects.toThrow('changed')
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    await instance.remove('test-account')
    pending.resolve({ kind: 'ok', access: 'test-access', expires: Date.now() + 3600_000 })
    await rejected
    expect(await instance.list()).toEqual([])
  })

  it('cancels login even when the OAuth provider ignores abort', async () => {
    const login = vi.fn(() => new Promise<never>(() => {}))
    const { instance } = manager(login)
    const request = instance.startLogin()
    const rejected = expect(request).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(login).toHaveBeenCalledOnce())
    instance.cancelLogin()
    await rejected
    instance.dispose()
    await expect(instance.init()).rejects.toThrow('disposed')
  })
})
