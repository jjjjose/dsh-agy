import { describe, expect, it } from 'vitest'
import { formatDuration, formatQuotaReport } from '../src/quota.ts'
import type { AccountQuotaResult } from '../src/types.ts'

describe('formatDuration', () => {
  it('formats days, hours, and minutes', () => {
    expect(formatDuration(90_000_000)).toBe('1d 1h')
    expect(formatDuration(3_600_000)).toBe('1h 0m')
    expect(formatDuration(120_000)).toBe('2m')
  })
})

describe('formatQuotaReport', () => {
  it('renders a header when there are no accounts', () => {
    expect(formatQuotaReport([])).toContain('No accounts configured')
  })

  it('renders per-account buckets as a markdown table', () => {
    const results: AccountQuotaResult[] = [
      {
        accountId: 'a1',
        email: 'user@example.com',
        status: 'ok',
        buckets: [
          {
            window: '5h',
            label: 'Gemini',
            remainingFraction: 0.5,
            remainingPercentage: 50,
            resetTime: new Date(Date.now() + 3_600_000),
            timeUntilReset: 3_600_000,
            timeUntilResetFormatted: '1h 0m',
          },
        ],
      },
    ]
    const report = formatQuotaReport(results)
    expect(report).toContain('user@example.com')
    expect(report).toContain('| Window | Remaining | Resets in |')
    expect(report).toContain('50%')
  })

  it('surfaces disabled and error states', () => {
    const results: AccountQuotaResult[] = [
      { accountId: 'b', status: 'disabled', buckets: [] },
      { accountId: 'c', status: 'error', error: 'HTTP 403', buckets: [] },
    ]
    const report = formatQuotaReport(results)
    expect(report).toContain('disabled')
    expect(report).toContain('HTTP 403')
  })
})
