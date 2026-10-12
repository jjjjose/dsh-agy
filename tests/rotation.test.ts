import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HEALTH,
  HealthTracker,
  TokenBucket,
  isCoolingDown,
  isRateLimited,
  selectAccount,
} from '../src/rotation.ts'
import type { Account } from '../src/types.ts'

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    refreshToken: `refresh-${id}`,
    projectId: 'proj',
    addedAt: 0,
    lastUsed: 0,
    enabled: true,
    ...overrides,
  }
}

describe('HealthTracker', () => {
  it('starts new accounts at the initial score', () => {
    const health = new HealthTracker()
    expect(health.get('a')).toBe(DEFAULT_HEALTH.initial)
  })

  it('reduces the score on rate limits and marks the account unusable when low', () => {
    const health = new HealthTracker()
    health.rateLimited('a')
    expect(health.get('a')).toBe(DEFAULT_HEALTH.initial + DEFAULT_HEALTH.rateLimitPenalty)
    // one penalty (60) is still >= minUsable (50)
    expect(health.isUsable('a')).toBe(true)
    // repeated penalties drop it below the usable floor
    health.rateLimited('a')
    health.rateLimited('a')
    expect(health.get('a')).toBeLessThan(DEFAULT_HEALTH.minUsable)
    expect(health.isUsable('a')).toBe(false)
  })

  it('recovers over time', () => {
    const health = new HealthTracker()
    const now = Date.now()
    health.failure('a', now)
    const after = health.get('a', now + 10 * 3_600_000)
    expect(after).toBeGreaterThan(health.get('a', now))
  })

  it('caps the score at max', () => {
    const health = new HealthTracker()
    const now = Date.now()
    for (let i = 0; i < 200; i++) health.success('a', now + i)
    expect(health.get('a', now + 1000)).toBeLessThanOrEqual(DEFAULT_HEALTH.max)
  })
})

describe('TokenBucket', () => {
  it('consumes and regenerates tokens', () => {
    const bucket = new TokenBucket(10, 6)
    const now = Date.now()
    expect(bucket.has('a', 1, now)).toBe(true)
    expect(bucket.consume('a', 5, now)).toBe(true)
    expect(bucket.balance('a', now)).toBe(5)
    // one minute later: +6 tokens, capped at max
    expect(bucket.balance('a', now + 60_000)).toBe(10)
  })

  it('refuses to consume below zero', () => {
    const bucket = new TokenBucket(2, 1)
    const now = Date.now()
    expect(bucket.consume('a', 2, now)).toBe(true)
    expect(bucket.consume('a', 1, now)).toBe(false)
  })

  it('refunds tokens', () => {
    const bucket = new TokenBucket(10, 1)
    const now = Date.now()
    bucket.consume('a', 10, now)
    expect(bucket.balance('a', now)).toBe(0)
    bucket.refund('a', 4, now)
    expect(bucket.balance('a', now)).toBe(4)
  })
})

describe('isRateLimited / isCoolingDown', () => {
  it('detects active rate-limit windows', () => {
    const now = Date.now()
    expect(isRateLimited(account('a', { rateLimitedUntil: { all: now + 1000 } }), now)).toBe(true)
    expect(isRateLimited(account('a', { rateLimitedUntil: { all: now - 1000 } }), now)).toBe(false)
    expect(isRateLimited(account('a'), now)).toBe(false)
  })

  it('detects active cooldowns', () => {
    const now = Date.now()
    expect(isCoolingDown(account('a', { coolingDownUntil: now + 1000 }), now)).toBe(true)
    expect(isCoolingDown(account('a', { coolingDownUntil: now - 1000 }), now)).toBe(false)
  })
})

describe('selectAccount', () => {
  it('skips disabled, rate-limited, and cooling accounts', () => {
    const now = Date.now()
    const health = new HealthTracker()
    const bucket = new TokenBucket()
    const chosen = selectAccount({
      accounts: [
        account('disabled', { enabled: false }),
        account('limited', { rateLimitedUntil: { all: now + 60_000 } }),
        account('cooling', { coolingDownUntil: now + 60_000 }),
        account('good'),
      ],
      health,
      bucket,
      now,
    })
    expect(chosen).toBe('good')
  })

  it('returns undefined when nothing is usable', () => {
    const health = new HealthTracker()
    const bucket = new TokenBucket()
    const chosen = selectAccount({ accounts: [account('a', { enabled: false })], health, bucket })
    expect(chosen).toBeUndefined()
  })

  it('sticks to the active account unless another is clearly better', () => {
    const now = Date.now()
    const health = new HealthTracker()
    const bucket = new TokenBucket()
    const accounts = [account('active', { lastUsed: now }), account('other', { lastUsed: now })]
    const chosen = selectAccount({ accounts, activeId: 'active', health, bucket, now })
    expect(chosen).toBe('active')
  })

  it('switches when the active account is rate-limited', () => {
    const now = Date.now()
    const health = new HealthTracker()
    const bucket = new TokenBucket()
    const accounts = [
      account('active', { rateLimitedUntil: { all: now + 60_000 } }),
      account('other'),
    ]
    const chosen = selectAccount({ accounts, activeId: 'active', health, bucket, now })
    expect(chosen).toBe('other')
  })
})
