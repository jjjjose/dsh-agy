/** Bounded, opt-in transport diagnostics. Only the enabled preference is saved. */
import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { stateDir } from './storage.ts'
import type { DiagnosticEntry, DiagnosticRecord, DiagnosticSnapshot } from './diagnostics-format.ts'

const EVENTS = new Set(['request-start', 'http-response', 'network-error', 'endpoint-retry', 'account-rotation', 'schema-error', 'generation-finish', 'request-complete', 'request-error', 'request-aborted'])
const safeLabel = (value: string, limit: number): string => value.replace(/[^a-zA-Z0-9_./#~\[\]-]/g, '_').slice(0, limit)

export class Diagnostics {
  private enabled = false
  private entries: DiagnosticEntry[] = []
  private pending: Promise<unknown> = Promise.resolve()
  private readonly directory: string
  private readonly file: string
  readonly limit = 200

  constructor(private readonly version: string, directory = stateDir(), private readonly now = Date.now) {
    this.directory = directory
    this.file = join(directory, 'diagnostics-config.json')
    try {
      const stored: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      this.enabled = typeof stored === 'object' && stored !== null && (stored as { enabled?: unknown }).enabled === true
    } catch { /* Missing/invalid preferences default to disabled; no startup writes. */ }
  }

  configure(enabled: boolean): Promise<DiagnosticSnapshot> {
    const run = this.pending.then(async () => {
      const temporary = `${this.file}.${randomUUID()}.tmp`
      try {
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
        await fs.writeFile(temporary, JSON.stringify({ enabled }), { mode: 0o600 })
        await fs.rename(temporary, this.file)
        this.enabled = enabled
      } catch (error) {
        await fs.unlink(temporary).catch(() => undefined)
        throw error
      }
      return this.snapshot()
    })
    this.pending = run.catch(() => undefined)
    return run
  }

  record(value: DiagnosticRecord): void {
    if (!this.enabled || !EVENTS.has(value.event)) return
    // Construct an allowlisted record; never spread provider objects/errors.
    const entry: DiagnosticEntry = { time: this.now(), event: value.event,
      requestId: safeLabel(value.requestId, 80), model: safeLabel(value.model, 100) }
    for (const key of ['toolCount', 'durationMs', 'status', 'attempt'] as const) {
      const number = value[key]
      if (typeof number === 'number' && Number.isFinite(number) && number >= 0) entry[key] = Math.floor(number)
    }
    if (value.finishReason && /^[A-Z_]{1,64}$/.test(value.finishReason)) entry.finishReason = value.finishReason
    if (value.tool) entry.tool = safeLabel(value.tool, 64)
    if (value.schemaPath) entry.schemaPath = safeLabel(value.schemaPath, 240)
    if (value.stage && ['authentication', 'request', 'stream', 'generation', 'empty-response'].includes(value.stage)) entry.stage = value.stage
    this.entries.push(entry)
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit)
  }

  clear(): DiagnosticSnapshot { this.entries = []; return this.snapshot() }

  snapshot(): DiagnosticSnapshot {
    return { enabled: this.enabled, version: this.version, limit: this.limit, entries: this.entries.map((entry) => ({ ...entry })) }
  }
}
