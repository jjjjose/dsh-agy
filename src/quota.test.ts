import { afterEach, expect, it, vi } from 'vitest'
import { fetchAccountQuota, formatQuotaReport } from './quota.ts'

afterEach(() => vi.unstubAllGlobals())

it('preserves both quota windows and their independent reset times', async () => {
  const now = Date.now()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ groups: [{ displayName: 'Claude', buckets: [
    { window: '5h', remainingFraction: 0.25, resetTime: new Date(now + 3600_000).toISOString() },
    { window: 'weekly', remainingFraction: 0.75, resetTime: new Date(now + 7 * 86400_000).toISOString() },
  ] }] }))))
  const result = await fetchAccountQuota({ id: 'a', projectId: 'p', refreshToken: 'r', addedAt: 0, lastUsed: 0, enabled: true }, 'token')
  expect(result.status).toBe('ok')
  expect(result.buckets.map((bucket) => [bucket.window, bucket.remainingPercentage])).toEqual([['5h', 25], ['weekly', 75]])
  expect(result.buckets[1]!.resetTime.getTime()).toBe(now + 7 * 86400_000)
  expect(formatQuotaReport([result])).toContain('Claude (weekly)')
})
