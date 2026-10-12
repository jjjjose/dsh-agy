/**
 * Antigravity quota reporting: fetch the account's dual-window (5h + weekly)
 * usage and format a compact markdown table across all accounts.
 */

import { ENDPOINTS, antiGravityHeaders } from './constants.ts'
import type { Account, AccountQuotaResult, QuotaBucket } from './types.ts'

const FETCH_TIMEOUT_MS = 15_000

interface SummaryResponse {
  groups?: Array<{
    displayName?: string
    buckets?: Array<{ bucketId?: string; displayName?: string; window?: string; resetTime?: string; remainingFraction?: number }>
  }>
}

function normalizeFraction(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(Math.abs(ms) / 1000)
  const d = Math.floor(seconds / 86_400)
  const h = Math.floor((seconds % 86_400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** Fetch the dual-window quota summary for one access token. */
async function fetchSummary(access: string, projectId: string): Promise<SummaryResponse> {
  let lastError = ''
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}/v1internal:retrieveUserQuotaSummary`, {
        method: 'POST',
        headers: antiGravityHeaders(access),
        body: JSON.stringify({ project: projectId }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (response.ok) return (await response.json()) as SummaryResponse
      lastError = `HTTP ${response.status}`
      if (![403, 404, 429, 500, 502, 503, 504].includes(response.status)) break
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(`Antigravity quota summary failed (${lastError})`)
}

/** Collect quota buckets for one account. */
export async function fetchAccountQuota(account: Account, access: string): Promise<AccountQuotaResult> {
  if (!account.enabled) return { accountId: account.id, email: account.email, status: 'disabled', buckets: [] }
  try {
    const summary = await fetchSummary(access, account.projectId)
    const now = Date.now()
    const buckets: QuotaBucket[] = []
    for (const group of summary.groups ?? []) {
      for (const bucket of group.buckets ?? []) {
        const fraction = normalizeFraction(bucket.remainingFraction)
        let resetTime = new Date(now + 86_400_000)
        if (bucket.resetTime) {
          const parsed = new Date(bucket.resetTime)
          if (!Number.isNaN(parsed.getTime())) resetTime = parsed
        }
        const timeUntilReset = Math.max(0, resetTime.getTime() - now)
        buckets.push({
          window: bucket.window || bucket.bucketId || 'unknown',
          label: bucket.displayName || bucket.bucketId || `${group.displayName ?? 'Limit'}`,
          remainingFraction: fraction,
          remainingPercentage: Math.round(fraction * 100),
          resetTime,
          timeUntilReset,
          timeUntilResetFormatted: formatDuration(timeUntilReset),
        })
      }
    }
    return { accountId: account.id, email: account.email, status: 'ok', buckets }
  } catch (error) {
    return { accountId: account.id, email: account.email, status: 'error', error: error instanceof Error ? error.message : String(error), buckets: [] }
  }
}

function bar(percent: number, width = 12): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.round((clamped / 100) * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${clamped.toFixed(0)}%`.padEnd(20)
}

/** Format per-account quota results as a markdown report. */
export function formatQuotaReport(results: AccountQuotaResult[]): string {
  if (results.length === 0) return '# Antigravity Quota\n\nNo accounts configured.'
  const lines: string[] = ['# Antigravity Quota', '']
  for (const result of results) {
    const who = result.email ?? result.accountId.slice(0, 8)
    if (result.status === 'error') {
      lines.push(`- **${who}**: error — ${result.error ?? 'unknown'}`)
      continue
    }
    if (result.status === 'disabled') {
      lines.push(`- **${who}**: disabled`)
      continue
    }
    if (result.buckets.length === 0) {
      lines.push(`- **${who}**: no quota windows reported`)
      continue
    }
    lines.push(`**${who}**`)
    lines.push('')
    lines.push('| Window | Remaining | Resets in |')
    lines.push('| --- | --- | --- |')
    for (const bucket of result.buckets) {
      lines.push(`| ${bucket.label} (${bucket.window}) | ${bar(bucket.remainingPercentage)} | ${bucket.timeUntilResetFormatted} |`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
