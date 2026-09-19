import {
  RARITY_ORDER,
  totalWeight,
  type MachineConfig,
  type Rarity,
  type RewardTierConfig,
} from '@/config/machines'
import {assetByAddress, type RewardAsset} from '@/config/rewards'

/**
 * Demo-mode outcome generation.
 *
 * ## Why this file is separate, and why it is loud about itself
 *
 * In demo mode there is no chain, so the outcome has to come from somewhere. It comes from
 * here — and every value this module produces is stamped `simulated: true` so no caller can
 * accidentally present it as a real result.
 *
 * `crypto.getRandomValues` is used rather than `Math.random()`. It costs nothing and means
 * the demo cannot be pattern-matched or replayed, which matters because a predictable demo
 * would misrepresent how the real machine behaves.
 *
 * **This code path is unreachable in testnet and mainnet modes.** Live outcomes are resolved
 * onchain and read back from the contract; see `hooks/useSpin.ts`. `resolveMode()` returns
 * `misconfigured` rather than falling back here if a live mode is missing its addresses.
 */

/** A cryptographically-seeded integer in [0, max). */
function secureRandomInt(max: number): number {
  if (max <= 0) return 0
  const buffer = new Uint32Array(1)
  const limit = Math.floor(0xffffffff / max) * max
  // Rejection sampling, so the distribution is uniform rather than modulo-biased.
  let value: number
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0] ?? 0
  } while (value >= limit)
  return value % max
}

/** Picks an index uniformly. Used by the hero demonstration. */
export function drawDemoIndex(length: number): number {
  return secureRandomInt(Math.max(length, 1))
}

export type DemoOutcome = {
  /** Always true. Callers must surface this. */
  simulated: true
  tierIndex: number
  tier: RewardTierConfig
  asset: RewardAsset | undefined
  rarity: Rarity
  /** Reward amount in whole token units. */
  amount: number
  /** A fake but internally consistent identifier, prefixed so it cannot be mistaken for real. */
  demoSpinId: string
  drawnAt: number
}

/**
 * Draws a demo outcome using the same weighting the contract uses: pick a band by weight,
 * then pick an amount uniformly within that band. Mirroring the real algorithm means the
 * demo is an honest preview of the odds rather than a flattering one.
 */
export function drawDemoOutcome(machine: MachineConfig): DemoOutcome {
  const total = totalWeight(machine)
  const pick = secureRandomInt(Math.max(total, 1))

  let cumulative = 0
  let tierIndex = 0
  for (let i = 0; i < machine.tiers.length; i += 1) {
    const tier = machine.tiers[i]
    if (!tier) continue
    cumulative += tier.weight
    if (pick < cumulative) {
      tierIndex = i
      break
    }
  }

  const tier = machine.tiers[tierIndex]
  if (!tier) {
    throw new Error(`Machine ${machine.slug} has no reward tiers configured.`)
  }

  const min = Number.parseFloat(tier.minAmount)
  const max = Number.parseFloat(tier.maxAmount)
  // Quantise the band into steps so the amount has realistic-looking precision rather than
  // a float with fifteen decimal places.
  const steps = 10_000
  const offset = max > min ? (secureRandomInt(steps + 1) / steps) * (max - min) : 0
  const amount = min + offset

  return {
    simulated: true,
    tierIndex,
    tier,
    asset: assetByAddress(tier.token),
    rarity: tier.rarity,
    amount,
    demoSpinId: `demo-${Date.now().toString(36)}-${secureRandomInt(0xffff).toString(16)}`,
    drawnAt: Date.now(),
  }
}

/** Index of an outcome's asset within a machine's deduplicated asset list. */
export function assetIndexForOutcome(machine: MachineConfig, outcome: DemoOutcome): number {
  const seen: string[] = []
  for (const tier of machine.tiers) {
    const key = tier.token.toLowerCase()
    if (!seen.includes(key)) seen.push(key)
  }
  const index = seen.indexOf(outcome.tier.token.toLowerCase())
  return index === -1 ? 0 : index
}

export function rarityRank(rarity: Rarity): number {
  return RARITY_ORDER.indexOf(rarity)
}
