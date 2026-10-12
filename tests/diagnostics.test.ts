import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Diagnostics } from '../src/diagnostics.ts'
import { formatDiagnosticReport } from '../src/diagnostics-format.ts'
import type { DiagnosticRecord } from '../src/diagnostics-format.ts'

const directories: string[] = []
async function directory() {
  const path = await fs.mkdtemp(join(tmpdir(), 'dsh-agy-diagnostics-'))
  directories.push(path)
  return path
}
afterEach(async () => { for (const path of directories.splice(0)) await fs.rm(path, { recursive: true, force: true }) })
const entry: DiagnosticRecord = { event: 'request-start', requestId: 'agent-test', model: 'gemini-3.8-flash-high', toolCount: 135 }

describe('safe opt-in diagnostics', () => {
  it('defaults to disabled and never writes entries to disk', async () => {
    const path = await directory()
    const logs = new Diagnostics('0.1.1', path)
    logs.record(entry)
    expect(logs.snapshot().entries).toEqual([])
    expect(await fs.readdir(path)).toEqual([])
    await logs.configure(true)
    logs.record(entry)
    expect(await fs.readFile(join(path, 'diagnostics-config.json'), 'utf8')).toBe('{"enabled":true}')
    const reloaded = new Diagnostics('0.1.1', path)
    expect(reloaded.snapshot()).toMatchObject({ enabled: true, entries: [] })
  })
  it('limits entries to 200 and preserves history when disabled', async () => {
    const logs = new Diagnostics('0.1.1', await directory(), () => 1234)
    await logs.configure(true)
    for (let index = 0; index < 205; index++) logs.record({ ...entry, requestId: `agent-${index}` })
    expect(logs.snapshot().entries).toHaveLength(200)
    expect(logs.snapshot().entries[0]?.requestId).toBe('agent-5')
    await logs.configure(false)
    logs.record(entry)
    expect(logs.snapshot().entries).toHaveLength(200)
    expect(logs.clear()).toMatchObject({ enabled: false, entries: [] })
  })
  it('allowlists fields, rejects invalid values and returns detached snapshots', async () => {
    const logs = new Diagnostics('0.1.1', await directory(), () => 0)
    await logs.configure(true)
    logs.record({ ...entry, token: 'secret', prompt: 'private prompt', arguments: { secret: true }, finishMessage: 'private arguments', response: 'private answer', status: NaN, durationMs: -1, finishReason: 'private message' } as DiagnosticRecord)
    const snapshot = logs.snapshot()
    expect(snapshot.entries).toEqual([{ ...entry, time: 0 }])
    snapshot.entries[0]!.model = 'mutated'
    expect(logs.snapshot().entries[0]?.model).toBe(entry.model)
    const report = formatDiagnosticReport(logs.snapshot())
    expect(report).toContain('dsh-agy 0.1.1')
    expect(report).toContain('toolCount=135')
    for (const secret of ['secret', 'private prompt', 'private arguments', 'private answer']) expect(report).not.toContain(secret)
  })
  it('serializes preference changes and defaults invalid state to disabled', async () => {
    const path = await directory()
    await fs.writeFile(join(path, 'diagnostics-config.json'), '{"enabled":"true"}')
    const logs = new Diagnostics('0.1.1', path)
    expect(logs.snapshot().enabled).toBe(false)
    await Promise.all([logs.configure(true), logs.configure(false)])
    expect(logs.snapshot().enabled).toBe(false)
    expect(new Diagnostics('0.1.1', path).snapshot().enabled).toBe(false)
  })
  it('records adapter tool counts without storing declarations or content', async () => {
    const logs = new Diagnostics('0.2.0', await directory(), () => 0)
    await logs.configure(true)
    logs.record({ event: 'adapter-tools', requestId: 'adapter-test', model: 'gemini-3.8-flash', toolCount: 2,
      deferredToolCount: 1, tools: [{ name: 'private-tool', parameters: { secret: 'private-schema' } }] } as DiagnosticRecord)
    expect(logs.snapshot().entries).toEqual([{ time: 0, event: 'adapter-tools', requestId: 'adapter-test', model: 'gemini-3.8-flash', toolCount: 2, deferredToolCount: 1 }])
    const report = formatDiagnosticReport(logs.snapshot())
    expect(report).toContain('deferredToolCount=1')
    expect(report).not.toContain('private-tool')
    expect(report).not.toContain('private-schema')
  })
  it('does not change the active preference if persistence fails', async () => {
    const path = join(await directory(), 'not-a-directory')
    await fs.writeFile(path, '')
    const logs = new Diagnostics('0.1.1', path)
    await expect(logs.configure(true)).rejects.toThrow()
    expect(logs.snapshot().enabled).toBe(false)
  })
})
