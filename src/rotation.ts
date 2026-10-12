/**
 * Account selection logic: rate-limit / cooldown awareness, a health score, a
 * client-side token bucket, and a sticky LRU choice. Pure functions and small
 * in-memory trackers; the account manager owns the state and persistence.
 */

import type { Account } from './types.ts'

export interface HealthConfig {
  initial: number
  successReward: number
  rateLimitPenalty: number
  failurePenalty: number
  recoveryPerHour: number
  minUsable: number
  max: number
}

export const DEFAULT_HEALTH: HealthConfig = {
  initial: 70,
  successReward: 1,
  rateLimitPenalty: -10,
  failurePenalty: -20,
  recoveryPerHour: 2,
  minUsable: 50,
  max: 100,
}

interface HealthState {
  score: number
  updatedAt: number
  failures: number
}

/** In-memory health score tracker keyed by account id. */
export class HealthTracker {
  private readonly states = new Map<string, HealthState>()
  constructor(private readonly config: HealthConfig = DEFAULT_HEALTH) {}

  get(id: string, now = Date.now()): number {
    const state = this.states.get(id)
    if (!state) return this.config.initial
    const hours = (now - state.updatedAt) / 3_600_000
    return Math.min(this.config.max, state.score + Math.floor(hours * this.config.recoveryPerHour))
  }

  success(id: string, now = Date.now()): void {
    const score = Math.min(this.config.max, this.get(id, now) + this.config.successReward)
    this.states.set(id, { score, updatedAt: now, failures: 0 })
  }

  rateLimited(id: string, now = Date.now()): void {
    const state = this.states.get(id)
    const score = Math.max(0, this.get(id, now) + this.config.rateLimitPenalty)
    this.states.set(id, { score, updatedAt: now, failures: (state?.failures ?? 0) + 1 })
  }

  failure(id: string, now = Date.now()): void {
    const state = this.states.get(id)
    const score = Math.max(0, this.get(id, now) + this.config.failurePenalty)
    this.states.set(id, { score, updatedAt: now, failures: (state?.failures ?? 0) + 1 })
  }

  isUsable(id: string, now = Date.now()): boolean {
    return this.get(id, now) >= this.config.minUsable
  }
}

/** Client-side token bucket to smooth request bursts per account. */
export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>()
  constructor(
    private readonly max = 50,
    private readonly regenPerMinute = 6,
  ) {}

  /** Current token balance for an account, applying regeneration. */
  balance(id: string, now = Date.now()): number {
    const state = this.buckets.get(id)
    if (!state) return this.max
    const minutes = (now - state.updatedAt) / 60_000
    return Math.min(this.max, state.tokens + minutes * this.regenPerMinute)
  }

  has(id: string, cost = 1, now = Date.now()): boolean {
    return this.balance(id, now) >= cost
  }

  consume(id: string, cost = 1, now = Date.now()): boolean {
    const tokens = this.balance(id, now)
    if (tokens < cost) return false
    this.buckets.set(id, { tokens: tokens - cost, updatedAt: now })
    return true
  }

  refund(id: string, amount = 1, now = Date.now()): void {
    this.buckets.set(id, { tokens: Math.min(this.max, this.balance(id, now) + amount), updatedAt: now })
  }
}

/** Whether an account is inside a rate-limit window for any family. */
export function isRateLimited(account: Account, now = Date.now()): boolean {
  const until = account.rateLimitedUntil
  if (!until) return false
  return Object.values(until).some((t) => t > now)
}

/** Whether an account is cooling down after auth/network errors. */
export function isCoolingDown(account: Account, now = Date.now()): boolean {
  return (account.coolingDownUntil ?? 0) > now
}

export interface SelectionInput {
  accounts: Account[]
  activeId?: string
  health: HealthTracker
  bucket: TokenBucket
  now?: number
}

const STICKINESS = 150
const SWITCH_THRESHOLD = 100

/**
 * Pick the account to serve the next request.
 *
 * Filters to enabled accounts that are not rate-limited, not cooling down, and
 * healthy enough, then scores them by health (2x), token balance (5x) and
 * recency-of-rest (0.1x). The current account keeps a stickiness bonus so the
 * choice only changes when another account is clearly better.
 * @returns the chosen account id, or undefined when none are usable.
 */
export function selectAccount(input: SelectionInput): string | undefined {
  const now = input.now ?? Date.now()
  const candidates = input.accounts.filter(
    (a) => a.enabled
      && !isRateLimited(a, now)
      && !isCoolingDown(a, now)
      && input.health.isUsable(a.id, now)
      && input.bucket.has(a.id, 1, now),
  )
  if (candidates.length === 0) return undefined

  const scored = candidates.map((account) => {
    const health = input.health.get(account.id, now)
    const tokens = input.bucket.balance(account.id, now)
    const restSeconds = Math.min((now - account.lastUsed) / 1000, 3600)
    const base = health * 2 + (tokens / 50) * 100 * 5 + restSeconds * 0.1
    const stick = account.id === input.activeId ? STICKINESS : 0
    return { id: account.id, base, score: base + stick, isCurrent: account.id === input.activeId }
  }).sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (!best) return undefined
  const current = scored.find((s) => s.isCurrent)
  if (current && !best.isCurrent && best.base - current.base < SWITCH_THRESHOLD) {
    return current.id
  }
  return best.id
}
