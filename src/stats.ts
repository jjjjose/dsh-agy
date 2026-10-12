/** Token-free runtime activity shared by inference and the settings RPC. */
export class EngineStats {
  private readonly accounts = new Map<string, { success: number; rateLimits: number; errors: number }>()
  readonly startedAt = Date.now()

  record(accountId: string, kind: 'success' | 'rateLimits' | 'errors'): void {
    const entry = this.accounts.get(accountId) ?? { success: 0, rateLimits: 0, errors: 0 }
    entry[kind]++
    this.accounts.set(accountId, entry)
  }

  snapshot(): { startedAt: number; accounts: Array<{ accountId: string; success: number; rateLimits: number; errors: number }> } {
    return { startedAt: this.startedAt, accounts: [...this.accounts].map(([accountId, data]) => ({ accountId, ...data })) }
  }
}
