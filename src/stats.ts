/** Token-free runtime activity shared by inference and the settings RPC. */
export class EngineStats {
  private lastDiagnostic?: { model: string; finishReason?: string; kind: string; toolCount?: number; time: number }

  diagnostic(value: { model: string; finishReason?: string; kind: string; toolCount?: number }): void {
    this.lastDiagnostic = { ...value, time: Date.now() }
  }
  private readonly accounts = new Map<string, { success: number; rateLimits: number; errors: number }>()
  readonly startedAt = Date.now()

  record(accountId: string, kind: 'success' | 'rateLimits' | 'errors'): void {
    const entry = this.accounts.get(accountId) ?? { success: 0, rateLimits: 0, errors: 0 }
    entry[kind]++
    this.accounts.set(accountId, entry)
  }

  snapshot() {
    return { startedAt: this.startedAt, lastDiagnostic: this.lastDiagnostic, accounts: [...this.accounts].map(([accountId, data]) => ({ accountId, ...data })) }
  }
}
