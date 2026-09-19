/**
 * Responsible-play and jurisdiction configuration.
 *
 * ## Read this before shipping
 *
 * Arcade sells a randomised outcome for money. Depending on jurisdiction that may be
 * regulated as a lottery, a game of chance, a prize competition, or a gambling product, and
 * the rules differ sharply between regions and change often.
 *
 * These controls are **mechanism, not legal advice, and not a compliance opinion.** The
 * blocklist below is intentionally empty: guessing at a jurisdiction list would be worse
 * than shipping an obviously unconfigured one, because it would look like someone had done
 * the analysis. A production launch requires jurisdiction-specific legal review, and the
 * operator must populate these values from that review.
 *
 * Everything here is configurable through environment variables so the same build can be
 * deployed under different legal regimes.
 */

export type ComplianceConfig = {
  /** Minimum self-attested age. Attestation only — this is not identity verification. */
  minimumAge: number
  /**
   * ISO 3166-1 alpha-2 codes that may not play.
   *
   * Empty by default, on purpose. Populate from legal review. Client-side geo checks are
   * advisory; enforcement that matters has to happen at the edge or in the contract's
   * access layer.
   */
  blockedRegions: string[]
  /** Per-session spend ceiling in USDC. Zero disables the limit. */
  sessionSpendLimitUsdc: number
  /** Per-session spin ceiling. Zero disables the limit. */
  sessionSpinLimit: number
  /** Whether a player can self-exclude locally. */
  selfExclusionEnabled: boolean
  /** Days a self-exclusion lasts. */
  selfExclusionDays: number
}

function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function envList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code))
}

export const COMPLIANCE: ComplianceConfig = {
  minimumAge: envNumber(process.env.NEXT_PUBLIC_ARCADE_MIN_AGE, 18),
  blockedRegions: envList(process.env.NEXT_PUBLIC_ARCADE_BLOCKED_REGIONS),
  sessionSpendLimitUsdc: envNumber(process.env.NEXT_PUBLIC_ARCADE_SESSION_SPEND_LIMIT, 100),
  sessionSpinLimit: envNumber(process.env.NEXT_PUBLIC_ARCADE_SESSION_SPIN_LIMIT, 50),
  selfExclusionEnabled: process.env.NEXT_PUBLIC_ARCADE_SELF_EXCLUSION !== 'false',
  selfExclusionDays: envNumber(process.env.NEXT_PUBLIC_ARCADE_SELF_EXCLUSION_DAYS, 30),
}

/** localStorage keys. Deliberately local: Arcade stores no personal data server-side. */
export const COMPLIANCE_KEYS = {
  acknowledged: 'arcade.compliance.acknowledged.v1',
  selfExcludedUntil: 'arcade.compliance.selfExcludedUntil.v1',
  sessionSpend: 'arcade.session.spendUsdc.v1',
  sessionSpins: 'arcade.session.spins.v1',
  sessionStarted: 'arcade.session.startedAt.v1',
} as const

export type SessionUsage = {
  spendUsdc: number
  spins: number
  startedAt: number
}

/** A session resets after this long, so limits are per-sitting rather than forever. */
export const SESSION_WINDOW_MS = 12 * 60 * 60 * 1000

export type LimitCheck =
  | {allowed: true}
  | {allowed: false; reason: 'self-excluded'; until: number}
  | {allowed: false; reason: 'spend-limit'; limit: number; used: number}
  | {allowed: false; reason: 'spin-limit'; limit: number; used: number}

/**
 * Decides whether another spin is permitted under the configured limits.
 *
 * Pure, so it is unit-testable without a browser and cannot be accidentally bypassed by a
 * component forgetting one of the three conditions.
 */
export function checkLimits(
  usage: SessionUsage,
  spinCostUsdc: number,
  selfExcludedUntil: number | null,
  config: ComplianceConfig = COMPLIANCE,
  now = Date.now(),
): LimitCheck {
  if (selfExcludedUntil !== null && selfExcludedUntil > now) {
    return {allowed: false, reason: 'self-excluded', until: selfExcludedUntil}
  }

  const fresh = now - usage.startedAt > SESSION_WINDOW_MS
  const spend = fresh ? 0 : usage.spendUsdc
  const spins = fresh ? 0 : usage.spins

  if (config.sessionSpinLimit > 0 && spins + 1 > config.sessionSpinLimit) {
    return {allowed: false, reason: 'spin-limit', limit: config.sessionSpinLimit, used: spins}
  }

  if (config.sessionSpendLimitUsdc > 0 && spend + spinCostUsdc > config.sessionSpendLimitUsdc) {
    return {
      allowed: false,
      reason: 'spend-limit',
      limit: config.sessionSpendLimitUsdc,
      used: spend,
    }
  }

  return {allowed: true}
}

export function limitMessage(check: LimitCheck): string | null {
  if (check.allowed) return null
  switch (check.reason) {
    case 'self-excluded':
      return `You self-excluded until ${new Date(check.until).toLocaleDateString()}. Arcade will not accept spins from this browser until then.`
    case 'spend-limit':
      return `Session spend limit reached: ${check.used.toFixed(2)} of ${check.limit.toFixed(2)} USDC. This resets after a break.`
    case 'spin-limit':
      return `Session spin limit reached: ${check.used} of ${check.limit}. This resets after a break.`
  }
}
