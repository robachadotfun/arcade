import {describe, expect, it} from 'vitest'
import {
  checkLimits,
  limitMessage,
  SESSION_WINDOW_MS,
  type ComplianceConfig,
  type SessionUsage,
} from './compliance'

/**
 * The limit checker gates whether a spin is offered at all, so these tests pin down the
 * boundary conditions rather than the happy path.
 */

const CONFIG: ComplianceConfig = {
  minimumAge: 18,
  blockedRegions: [],
  sessionSpendLimitUsdc: 10,
  sessionSpinLimit: 3,
  selfExclusionEnabled: true,
  selfExclusionDays: 30,
}

const NOW = 1_700_000_000_000

function usage(partial: Partial<SessionUsage> = {}): SessionUsage {
  return {spendUsdc: 0, spins: 0, startedAt: NOW, ...partial}
}

describe('checkLimits', () => {
  it('allows a spin within both limits', () => {
    expect(checkLimits(usage(), 2, null, CONFIG, NOW)).toEqual({allowed: true})
  })

  it('blocks when the spin count limit would be exceeded', () => {
    const result = checkLimits(usage({spins: 3}), 2, null, CONFIG, NOW)
    expect(result.allowed).toBe(false)
    if (!result.allowed && result.reason === 'spin-limit') {
      expect(result.limit).toBe(3)
      expect(result.used).toBe(3)
    } else {
      throw new Error('expected a spin-limit block')
    }
  })

  it('allows exactly the last permitted spin', () => {
    // Two used of three: the third must still be allowed.
    expect(checkLimits(usage({spins: 2}), 2, null, CONFIG, NOW).allowed).toBe(true)
  })

  it('blocks when the spend limit would be exceeded, not merely reached', () => {
    // 9 spent, 2 more would be 11 against a limit of 10.
    const result = checkLimits(usage({spendUsdc: 9}), 2, null, CONFIG, NOW)
    expect(result.allowed).toBe(false)
    expect(result.allowed === false && result.reason).toBe('spend-limit')

    // Landing exactly on the limit is permitted.
    expect(checkLimits(usage({spendUsdc: 8}), 2, null, CONFIG, NOW).allowed).toBe(true)
  })

  it('treats self-exclusion as absolute, ahead of any other check', () => {
    const until = NOW + 1000
    const result = checkLimits(usage(), 2, until, CONFIG, NOW)
    expect(result.allowed).toBe(false)
    expect(result.allowed === false && result.reason).toBe('self-excluded')
  })

  it('lets an expired self-exclusion lapse', () => {
    expect(checkLimits(usage(), 2, NOW - 1, CONFIG, NOW).allowed).toBe(true)
  })

  it('resets usage once the session window has passed', () => {
    const stale = usage({spins: 99, spendUsdc: 999, startedAt: NOW - SESSION_WINDOW_MS - 1})
    expect(checkLimits(stale, 2, null, CONFIG, NOW).allowed).toBe(true)
  })

  it('does not reset usage just inside the window', () => {
    const recent = usage({spins: 99, spendUsdc: 999, startedAt: NOW - SESSION_WINDOW_MS + 1})
    expect(checkLimits(recent, 2, null, CONFIG, NOW).allowed).toBe(false)
  })

  it('treats a zero limit as disabled rather than as an immediate block', () => {
    const noLimits: ComplianceConfig = {
      ...CONFIG,
      sessionSpendLimitUsdc: 0,
      sessionSpinLimit: 0,
    }
    expect(checkLimits(usage({spins: 500, spendUsdc: 5000}), 2, null, noLimits, NOW).allowed).toBe(
      true,
    )
  })
})

describe('limitMessage', () => {
  it('returns null when a spin is allowed', () => {
    expect(limitMessage({allowed: true})).toBeNull()
  })

  it('explains every block reason in plain language', () => {
    const reasons = [
      checkLimits(usage({spins: 3}), 2, null, CONFIG, NOW),
      checkLimits(usage({spendUsdc: 9}), 2, null, CONFIG, NOW),
      checkLimits(usage(), 2, NOW + 1000, CONFIG, NOW),
    ]
    for (const reason of reasons) {
      const message = limitMessage(reason)
      expect(message).toBeTruthy()
      expect(message!.length).toBeGreaterThan(20)
    }
  })
})
