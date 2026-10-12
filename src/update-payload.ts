/** Strict npm archive validation and package-only replacement; no shell or lifecycle scripts. */
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const FILES = new Set(['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'README.md', 'docs/INSTALL.md', 'docs/ARCHITECTURE.md', 'docs/VALIDATION.md', 'docs/SELF_UPDATE.md', 'LICENSE'])
export interface PayloadFile { path: string; data: Buffer }

export function extractUpdate(tarball: Buffer, integrity: string, version: string): PayloadFile[] {
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity) || `sha512-${createHash('sha512').update(tarball).digest('base64')}` !== integrity) throw new Error('integrity-mismatch')
  const tar = gunzipSync(tarball, { maxOutputLength: 32 * 1024 * 1024 })
  const files: PayloadFile[] = []
  const seen = new Set<string>()
  let ended = false
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) { ended = true; break }
    const text = (start: number, length: number) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '')
    const octal = (start: number, length: number) => {
      const value = text(start, length).trim()
      if (!/^[0-7]+$/.test(value)) throw new Error('invalid-archive')
      return parseInt(value, 8)
    }
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
    if (octal(148, 8) !== checksum) throw new Error('invalid-archive')
    const path = (text(345, 155) ? `${text(345, 155)}/` : '') + text(0, 100)
    const size = octal(124, 12)
    const type = header[156]
    const end = offset + 512 + size
    if (end > tar.length) throw new Error('invalid-archive')
    if (type === 53) {
      if (!/^package\/(?:[A-Za-z0-9_-]+\/)*$/.test(path) || size !== 0) throw new Error('unsafe-archive')
    } else {
      // Reject links, PAX/GNU extensions, traversal, unexpected files and duplicates.
      const relative = path.startsWith('package/') ? path.slice(8) : ''
      if ((type !== 0 && type !== 48) || !FILES.has(relative) || seen.has(relative)) throw new Error('unsafe-archive')
      seen.add(relative)
      files.push({ path: relative, data: tar.subarray(offset + 512, end) })
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  if (!ended || !['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml'].every((path) => seen.has(path))) throw new Error('incomplete-archive')
  const manifest = JSON.parse(files.find((file) => file.path === 'package.json')!.data.toString('utf8')) as Record<string, unknown>
  if (manifest.name !== 'dsh-agy' || manifest.version !== version) throw new Error('identity-mismatch')
  return files
}

async function safeTarget(root: string, path: string): Promise<string> {
  if (!FILES.has(path)) throw new Error('unsafe-target')
  let cursor = root
  for (const part of ['', ...path.split('/')]) {
    if (part) cursor = join(cursor, part)
    try {
      const info = await fs.lstat(cursor)
      if (info.isSymbolicLink() || (cursor !== join(root, path) && !info.isDirectory())) throw new Error('unsafe-target')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return join(root, path)
}

/** Backup precedes all writes. Rollback restores touched files on replacement failure. */
export async function installUpdate(root: string, dataDir: string, files: PayloadFile[]): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 })
  const lockPath = join(dataDir, 'update.lock')
  const lock = await fs.open(lockPath, 'wx', 0o600)
  const backup = join(dataDir, `update-backup-${randomUUID()}`)
  const touched: Array<{ target: string; original?: Buffer }> = []
  const written = new Set<string>()
  try {
    // Recheck identity/version under the cross-process lock, not just before download.
    const incoming = JSON.parse(files.find((file) => file.path === 'package.json')!.data.toString('utf8')) as { name?: unknown; version?: unknown }
    const installed = JSON.parse(await fs.readFile(await safeTarget(root, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
    if (incoming.name !== 'dsh-agy' || installed.name !== 'dsh-agy') throw new Error('identity-mismatch')
    const parts = (version: unknown) => {
      if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('invalid-version')
      const values = version.split('.').map(Number)
      if (!values.every(Number.isSafeInteger)) throw new Error('invalid-version')
      return values
    }
    const next = parts(incoming.version), previous = parts(installed.version)
    const different = next.findIndex((part, index) => part !== previous[index])
    if (different === -1 || next[different]! < previous[different]!) throw new Error('package-version-changed')
    // Manifest is the final commit marker (each individual rename is atomic).
    files = [...files].sort((left, right) => Number(left.path === 'package.json') - Number(right.path === 'package.json'))
    const targets = await Promise.all(files.map((file) => safeTarget(root, file.path)))
    await fs.mkdir(backup, { mode: 0o700 })
    for (let index = 0; index < files.length; index++) {
      const file = files[index]!
      const target = targets[index]!
      let original: Buffer | undefined
      try { original = await fs.readFile(target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (original) {
        const saved = join(backup, file.path)
        await fs.mkdir(dirname(saved), { recursive: true })
        await fs.writeFile(saved, original, { mode: 0o600 })
      }
      touched.push({ target, original })
    }
    for (let index = 0; index < files.length; index++) {
      const target = targets[index]!
      await fs.mkdir(dirname(target), { recursive: true })
      const temp = `${target}.update-${randomUUID()}`
      try { await fs.writeFile(temp, files[index]!.data, { flag: 'wx', mode: 0o644 }); await fs.rename(temp, target); written.add(target) }
      finally { await fs.rm(temp, { force: true }) }
    }
  } catch (error) {
    for (const entry of touched) {
      if (!written.has(entry.target)) continue
      if (entry.original) await fs.writeFile(entry.target, entry.original)
      else await fs.rm(entry.target, { force: true })
    }
    throw error
  } finally {
    await lock.close()
    await fs.rm(lockPath, { force: true })
  }
}
