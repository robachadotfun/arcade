import {
  totalWeight,
  type MachineConfig,
  type RewardTierConfig,
} from '@/config/machines'
import {labelFor, assetByAddress} from '@/config/rewards'

/**
 * Machine economics: expected value, maximum liability, inventory runway.
 *
 * ## The thing this module exists to prevent
 *
 * A machine whose expected payout exceeds its spin revenue drains the treasury with every
 * spin, and a machine whose worst case exceeds its inventory can accept a spin it cannot
 * pay out. Both are configuration mistakes, both are silent, and both are catastrophic.
 * {@link evaluateMachine} makes them loud, and the admin UI refuses to activate a version
 * that trips a hard check.
 *
 * ## Why prices are an input, not a lookup
 *
 * Token prices are volatile and the assets in these machines are thin. Nothing here fetches
 * a spot price and treats it as truth. Callers pass a price snapshot explicitly, results are
 * labelled with how stale that snapshot is, and the onchain solvency guard
 * (`PrizeVault.availableOf` vs worst-case liability) is enforced in *token units* where no
 * price is involved at all. USD figures here inform a human decision; they never gate a payout.
 */

/** A price snapshot supplied by the caller. Explicitly not fetched here. */
export type PriceSnapshot = {
  /** USD price per whole token, keyed by lowercased address. */
  prices: Record<string, number>
  capturedAt: string
  source: string
}

export type RiskLevel = 'ok' | 'warn' | 'critical'

export type TierEconomics = {
  tier: RewardTierConfig
  symbol: string
  probability: number
  /** Mean reward within the band, in whole token units. */
  meanAmount: number
  maxAmount: number
  /** probability x mean x price. Contribution to expected payout per spin, in USD. */
  expectedCostUsd: number | null
  /** Worst-case payout for this tier alone, in USD. */
  maxPayoutUsd: number | null
  priceKnown: boolean
}

export type TokenLiability = {
  address: string
  symbol: string
  decimals: number
  /** Worst-case units payable for a single spin on this machine. */
  worstCasePerSpin: number
  /** Worst-case units for the configured number of concurrent spins. */
  worstCaseTotal: number
  /** Inventory the vault holds, in whole units, when known. */
  inventory: number | null
  /** Spins the current inventory could cover at worst case. */
  runwaySpins: number | null
  covered: boolean
}

export type MachineEconomics = {
  machine: MachineConfig
  spinRevenueUsd: number
  /** Sum of probability x mean x price across tiers. Null if any price is missing. */
  expectedPayoutUsd: number | null
  /** expectedPayout / revenue. Above 1.0 means the machine loses money per spin. */
  payoutRatio: number | null
  /** Revenue retained per spin after expected payout. */
  marginUsd: number | null
  tiers: TierEconomics[]
  liabilities: TokenLiability[]
  /** Raw sum of tier weights, e.g. 10000 — NOT a fraction. Probabilities are weight/this. */
  weightsSumTo: number
  findings: Finding[]
  /** Worst severity across all findings. */
  risk: RiskLevel
  /** Hard blockers. A version with any of these must not be activated. */
  blocking: Finding[]
  priceCoverage: {known: number; total: number; capturedAt: string; source: string}
}

export type Finding = {
  code: string
  level: RiskLevel
  /** True when this finding must block activation outright. */
  blocking: boolean
  message: string
}

/**
 * Safety thresholds. The payout ceiling is the important one: a machine configured above
 * it is structurally unprofitable and will drain reward inventory.
 */
export const SAFETY = {
  /** Expected payout must stay at or below this share of spin revenue. */
  maxPayoutRatio: 0.85,
  /** Warn below this margin even when the hard ceiling passes. */
  warnPayoutRatio: 0.7,
  /** Inventory should cover at least this many worst-case spins per token. */
  minRunwaySpins: 25,
  /** Concurrent in-flight spins the liability check should assume. */
  assumedConcurrentSpins: 10,
} as const

function meanOf(min: string, max: string): number {
  const lo = Number.parseFloat(min)
  const hi = Number.parseFloat(max)
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0
  return (lo + hi) / 2
}

/**
 * Evaluates a machine's economics and safety.
 *
 * @param inventory Optional vault inventory in whole token units, keyed by lowercased
 *                  address. When omitted, runway findings are reported as unknown rather
 *                  than assumed safe.
 */
export function evaluateMachine(
  machine: MachineConfig,
  snapshot: PriceSnapshot,
  inventory?: Record<string, number>,
): MachineEconomics {
  const weights = totalWeight(machine)
  const spinRevenueUsd = Number.parseFloat(machine.spinPriceUsdc)

  const priceOf = (address: string): number | null => {
    const price = snapshot.prices[address.toLowerCase()]
    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null
  }

  const tiers: TierEconomics[] = machine.tiers.map((tier) => {
    const asset = assetByAddress(tier.token)
    const probability = weights === 0 ? 0 : tier.weight / weights
    const meanAmount = meanOf(tier.minAmount, tier.maxAmount)
    const maxAmount = Number.parseFloat(tier.maxAmount)
    const price = priceOf(tier.token)

    return {
      tier,
      symbol: asset ? labelFor(asset) : 'UNKNOWN',
      probability,
      meanAmount,
      maxAmount: Number.isFinite(maxAmount) ? maxAmount : 0,
      expectedCostUsd: price === null ? null : probability * meanAmount * price,
      maxPayoutUsd: price === null ? null : maxAmount * price,
      priceKnown: price !== null,
    }
  })

  const knownPrices = tiers.filter((t) => t.priceKnown).length
  const allPricesKnown = knownPrices === tiers.length && tiers.length > 0

  const expectedPayoutUsd = allPricesKnown
    ? tiers.reduce((sum, t) => sum + (t.expectedCostUsd ?? 0), 0)
    : null

  const payoutRatio =
    expectedPayoutUsd !== null && spinRevenueUsd > 0 ? expectedPayoutUsd / spinRevenueUsd : null
  const marginUsd = expectedPayoutUsd !== null ? spinRevenueUsd - expectedPayoutUsd : null

  // Worst case per token: the largest maxAmount across tiers paying that token. Matches
  // the onchain `_worstCase` computation exactly, so the UI cannot disagree with the guard.
  const worstCaseByToken = new Map<string, number>()
  for (const tier of machine.tiers) {
    const key = tier.token.toLowerCase()
    const max = Number.parseFloat(tier.maxAmount)
    const current = worstCaseByToken.get(key) ?? 0
    if (Number.isFinite(max) && max > current) worstCaseByToken.set(key, max)
  }

  const liabilities: TokenLiability[] = [...worstCaseByToken.entries()].map(([address, worst]) => {
    const asset = assetByAddress(address)
    const held = inventory?.[address]
    const inv = typeof held === 'number' && Number.isFinite(held) ? held : null
    const worstCaseTotal = worst * SAFETY.assumedConcurrentSpins

    return {
      address,
      symbol: asset ? labelFor(asset) : 'UNKNOWN',
      decimals: asset?.decimals ?? 18,
      worstCasePerSpin: worst,
      worstCaseTotal,
      inventory: inv,
      runwaySpins: inv === null || worst === 0 ? null : Math.floor(inv / worst),
      covered: inv === null ? false : inv >= worstCaseTotal,
    }
  })

  const findings: Finding[] = []

  if (weights <= 0) {
    findings.push({
      code: 'zero-weight',
      level: 'critical',
      blocking: true,
      message: 'Total probability weight is zero. No outcome could ever be selected.',
    })
  }

  if (machine.tiers.length === 0) {
    findings.push({
      code: 'empty-table',
      level: 'critical',
      blocking: true,
      message: 'The reward table is empty.',
    })
  }

  for (const tier of machine.tiers) {
    const asset = assetByAddress(tier.token)
    if (!asset) {
      findings.push({
        code: 'unverified-token',
        level: 'critical',
        blocking: true,
        message: `${tier.token} is not in the verified reward registry. Run pnpm verify:tokens before configuring it.`,
      })
      continue
    }
    if (!asset.transferVerified) {
      findings.push({
        code: 'transfer-unverified',
        level: 'critical',
        blocking: true,
        message: `${asset.symbol} has no confirmed live transfer probe. Rewards could fail to deliver.`,
      })
    }
    const lo = Number.parseFloat(tier.minAmount)
    const hi = Number.parseFloat(tier.maxAmount)
    if (!(lo > 0) || !(hi >= lo)) {
      findings.push({
        code: 'bad-band',
        level: 'critical',
        blocking: true,
        message: `${asset.symbol} has an invalid reward band (${tier.minAmount} to ${tier.maxAmount}).`,
      })
    }
  }

  if (payoutRatio === null) {
    findings.push({
      code: 'prices-unknown',
      level: 'warn',
      blocking: false,
      message: `Expected value cannot be computed: ${tiers.length - knownPrices} of ${tiers.length} reward assets have no price in this snapshot. The onchain solvency guard still applies in token units.`,
    })
  } else if (payoutRatio > 1) {
    findings.push({
      code: 'negative-margin',
      level: 'critical',
      blocking: true,
      message: `Expected payout is ${(payoutRatio * 100).toFixed(1)}% of spin revenue. This machine loses money on every spin.`,
    })
  } else if (payoutRatio > SAFETY.maxPayoutRatio) {
    findings.push({
      code: 'payout-over-ceiling',
      level: 'critical',
      blocking: true,
      message: `Expected payout is ${(payoutRatio * 100).toFixed(1)}% of revenue, above the ${(SAFETY.maxPayoutRatio * 100).toFixed(0)}% ceiling.`,
    })
  } else if (payoutRatio > SAFETY.warnPayoutRatio) {
    findings.push({
      code: 'payout-thin',
      level: 'warn',
      blocking: false,
      message: `Expected payout is ${(payoutRatio * 100).toFixed(1)}% of revenue. Thin, but inside the ceiling.`,
    })
  }

  for (const liability of liabilities) {
    if (liability.inventory === null) {
      findings.push({
        code: 'inventory-unknown',
        level: 'warn',
        blocking: false,
        message: `${liability.symbol} inventory is unknown. Read the vault balance before activating.`,
      })
      continue
    }
    if (!liability.covered) {
      findings.push({
        code: 'inventory-short',
        level: 'critical',
        blocking: true,
        message: `${liability.symbol} inventory (${formatUnitsShort(liability.inventory)}) cannot cover the worst case for ${SAFETY.assumedConcurrentSpins} concurrent spins (${formatUnitsShort(liability.worstCaseTotal)}).`,
      })
    } else if (liability.runwaySpins !== null && liability.runwaySpins < SAFETY.minRunwaySpins) {
      findings.push({
        code: 'runway-short',
        level: 'warn',
        blocking: false,
        message: `${liability.symbol} inventory covers only ${liability.runwaySpins} worst-case spins. Top up before this runs out.`,
      })
    }
  }

  const blocking = findings.filter((f) => f.blocking)
  const risk: RiskLevel = blocking.length
    ? 'critical'
    : findings.some((f) => f.level === 'warn')
      ? 'warn'
      : 'ok'

  return {
    machine,
    spinRevenueUsd,
    expectedPayoutUsd,
    payoutRatio,
    marginUsd,
    tiers,
    liabilities,
    weightsSumTo: weights,
    findings,
    risk,
    blocking,
    priceCoverage: {
      known: knownPrices,
      total: tiers.length,
      capturedAt: snapshot.capturedAt,
      source: snapshot.source,
    },
  }
}

/** Compact number formatting for large token amounts. */
export function formatUnitsShort(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  if (abs >= 1) return value.toFixed(2)
  if (abs === 0) return '0'
  // Small-value assets (cirBTC, WETH) need real precision, not 0.00.
  return value.toPrecision(3)
}

export const RISK_LABEL: Record<RiskLevel, string> = {
  ok: 'Within limits',
  warn: 'Review',
  critical: 'Blocked',
}
