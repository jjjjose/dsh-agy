import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSelfUpdater, validateUpdateConfig } from '../src/self-update.ts'
import { extractUpdate, installUpdate } from '../src/update-payload.ts'

const directories: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})
function archive(version = '0.2.0', extra?: string, dependencies?: Record<string, string>) {
  const entries = [
    ['package/package.json', JSON.stringify({ name: 'dsh-agy', version, ...(dependencies ? { dependencies } : {}) })],
    ['package/lib/index.js', 'new host'], ['package/lib/client.js', 'new client'], ['package/cordis.patch.yml', 'patch'],
    ...(extra ? [[extra, 'bad']] : []),
  ]
  const blocks: Buffer[] = []
  for (const [path, content] of entries) {
    const data = Buffer.from(content!)
    const header = Buffer.alloc(512)
    header.write(path!, 0)
    header.write('0000644\0', 100)
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124)
    header.fill(32, 148, 156)
    header[156] = 48
    header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512))
  }
  const tarball = gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
  return { tarball, integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}` }
}
async function fixture(options: Parameters<typeof createSelfUpdater>[0] = {}) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-agy-update-test-'))
  directories.push(dir)
  const root = join(dir, 'package'), data = join(dir, 'state')
  await fs.mkdir(root)
  await fs.writeFile(join(root, 'package.json'), JSON.stringify({ name: 'dsh-agy', version: '0.1.0' }))
  const payload = archive()
  const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/latest')
    ? new Response(JSON.stringify({ name: 'dsh-agy', version: '0.2.0', dist: { integrity: payload.integrity, tarball: 'https://registry.example/dsh-agy.tgz' } }))
    : new Response(new Uint8Array(payload.tarball)))
  const updater = createSelfUpdater({ packageDir: root, dataDir: data, installAllowed: true, fetch: fetchMock, ...options })
  return { dir, root, data, fetchMock, updater }
}
const configured = { enabled: false, registryOrigin: 'https://registry.example', intervalMs: 60000 }

describe('package self-update', () => {
  it('defaults to no source and no network or state writes', async () => {
    const { updater, fetchMock, data } = await fixture()
    updater.start()
    expect(updater.status()).toMatchObject({ enabled: false, configured: false })
    expect((await updater.check()).lastError).toBe('source-not-configured')
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(fs.stat(data)).rejects.toMatchObject({ code: 'ENOENT' })
    updater.dispose()
  })
  it('check only fetches metadata; manual install verifies payload and requires restart', async () => {
    const install = vi.fn(installUpdate)
    const { updater, fetchMock, root } = await fixture({ config: configured, install })
    expect((await updater.check()).available).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(install).not.toHaveBeenCalled()
    expect((await updater.update()).pendingRestart).toBe(true)
    expect(await fs.readFile(join(root, 'lib/index.js'), 'utf8')).toBe('new host')
    await updater.update()
    expect(install).toHaveBeenCalledTimes(1)
    updater.dispose()
  })
  it('persists enabled, interval and source and rejects unsafe origins', async () => {
    const { updater, root, data } = await fixture()
    await updater.configure({ ...configured, enabled: true })
    updater.dispose()
    const restored = createSelfUpdater({ packageDir: root, dataDir: data, installAllowed: true })
    expect(restored.status()).toMatchObject({ ...configured, enabled: true })
    for (const registryOrigin of ['http://registry.example', 'https://user:pass@registry.example', 'https://registry.example/path', 'https://registry.example/?token=x']) {
      await expect(restored.configure({ registryOrigin })).rejects.toThrow()
    }
    await expect(restored.configure({ intervalMs: 1 })).rejects.toThrow()
    await expect(restored.configure({ enabled: 'yes' })).rejects.toThrow()
    restored.dispose()
  })
  it('rejects mismatched identity and cross-origin tarballs before downloading', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ name: 'dsh-chatgpt-sub', version: '0.2.0', dist: { integrity: archive().integrity, tarball: 'https://registry.example/x' } })))
    const { updater } = await fixture({ config: configured, fetch: fetchMock })
    expect((await updater.update()).lastError).toBe('invalid-release')
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ name: 'dsh-agy', version: '0.2.0', dist: { integrity: archive().integrity, tarball: 'https://other.example/x' } })))
    expect((await updater.update()).lastError).toBe('unsafe-download-origin')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    updater.dispose()
  })
  it('blocks installation in development copies', async () => {
    const { updater, fetchMock } = await fixture({ config: configured, installAllowed: false })
    expect((await updater.update()).lastError).toBe('profile-install-required')
    expect(fetchMock).not.toHaveBeenCalled()
    updater.dispose()
  })
  it('schedules automatic installs at configured interval, pauses on settings and disposes timers', async () => {
    const { updater } = await fixture({ config: { ...configured, enabled: true }, install: vi.fn(async () => undefined) })
    vi.useFakeTimers()
    updater.start()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(updater.status().latest).toBe('0.2.0')
    updater.visitSettings()
    expect(vi.getTimerCount()).toBe(0)
    updater.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('deduplicates concurrent checks and installs separately', async () => {
    const install = vi.fn(async () => undefined)
    const { updater } = await fixture({ config: configured, install })
    const first = updater.check(), second = updater.check()
    expect(first).toBe(second)
    await Promise.all([first, updater.update(), updater.update()])
    expect(install).toHaveBeenCalledTimes(1)
    updater.dispose()
  })
  it('refuses dependency changes rather than executing npm or lifecycle scripts', async () => {
    const payload = archive('0.2.0', undefined, { unexpected: '1.0.0' })
    const fetchMock = vi.fn<typeof fetch>(async (url) => String(url).endsWith('/latest')
      ? new Response(JSON.stringify({ name: 'dsh-agy', version: '0.2.0', dist: { integrity: payload.integrity, tarball: 'https://registry.example/x' } }))
      : new Response(new Uint8Array(payload.tarball)))
    const install = vi.fn(async () => undefined)
    const { updater } = await fixture({ config: configured, fetch: fetchMock, install })
    expect((await updater.update()).lastError).toBe('dependency-change-requires-manual-install')
    expect(install).not.toHaveBeenCalled()
    updater.dispose()
  })
})

describe('update payload security', () => {
  it('checks SHA512 and rejects traversal, unexpected files and duplicates', () => {
    const valid = archive()
    expect(extractUpdate(valid.tarball, valid.integrity, '0.2.0')).toHaveLength(4)
    expect(() => extractUpdate(valid.tarball, 'sha512-AAAA', '0.2.0')).toThrow('integrity-mismatch')
    for (const path of ['package/../accounts.json', 'package/src/index.ts', 'package/lib/index.js', 'package/.npmrc']) {
      const unsafe = archive('0.2.0', path)
      expect(() => extractUpdate(unsafe.tarball, unsafe.integrity, '0.2.0')).toThrow('unsafe-archive')
    }
  })
  it('rejects manifest version mismatch', () => {
    const valid = archive()
    expect(() => extractUpdate(valid.tarball, valid.integrity, '9.0.0')).toThrow('identity-mismatch')
  })
  it('rejects a symlink target without modifying package or outside files', async () => {
    const { root, data, dir, updater } = await fixture()
    const outside = join(dir, 'outside')
    await fs.mkdir(outside)
    await fs.symlink(outside, join(root, 'lib'))
    const valid = archive()
    await expect(installUpdate(root, data, extractUpdate(valid.tarball, valid.integrity, '0.2.0'))).rejects.toThrow('unsafe-target')
    expect(await fs.readdir(outside)).toEqual([])
    expect(JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8')).version).toBe('0.1.0')
    updater.dispose()
  })
  it('validates configuration independently without network calls', () => {
    expect(validateUpdateConfig({ registryOrigin: 'https://registry.example/' }, configured).registryOrigin).toBe('https://registry.example')
    expect(() => validateUpdateConfig({ unknown: true }, configured)).toThrow('Unknown update option')
  })
})
