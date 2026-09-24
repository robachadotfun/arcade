import {describe, expect, it} from 'vitest'
import {evaluateMachine, SAFETY, formatUnitsShort, type PriceSnapshot} from './economics'
import {MACHINES, machineBySlug, rarityOdds, totalWeight, type MachineConfig} from '@/config/machines'
import {REWARD_ASSETS} from '@/config/rewards'

/**
 * The economics module decides whether a machine may go live, so these tests exist to prove
 * that an unsafe configuration is actually rejected rather than merely warned about.
 */

/** Prices for every verified asset, so EV is computable. Values are arbitrary test inputs. */
const FULL_PRICES: PriceSnapshot = {
  prices: Object.fromEntries(REWARD_ASSETS.map((a) => [a.address.toLowerCase(), 0.01])),
  capturedAt: '2026-09-18T00:00:00.000Z',
  source: 'test',
}

const NO_PRICES: PriceSnapshot = {prices: {}, capturedAt: 'n/a', source: 'test'}

function genesis(): MachineConfig {
  const machine = machineBySlug('genesis')
  if (!machine) throw new Error('genesis machine missing from configuration')
  return machine
}

describe('machine odds', () => {
  it('every live machine publishes probabilities summing to 1', () => {
    for (const slug of ['genesis', 'velocity', 'blue-chip', 'discovery']) {
      const machine = machineBySlug(slug)
      expect(machine, `${slug} should exist`).toBeDefined()
      const total = rarityOdds(machine!).reduce((sum, band) => sum + band.probability, 0)
      expect(total, `${slug} probabilities`).toBeCloseTo(1, 10)
    }
  })

  it('weights are positive integers, so the contract cannot divide by zero', () => {
    for (const machine of ['genesis', 'velocity', 'blue-chip', 'discovery'].map(machineBySlug)) {
      expect(totalWeight(machine!)).toBeGreaterThan(0)
      for (const tier of machine!.tiers) {
        expect(Number.isInteger(tier.weight)).toBe(true)
        expect(tier.weight).toBeGreaterThan(0)
      }
    }
  })

  it('reward bands are ordered and non-zero', () => {
    for (const machine of ['genesis', 'velocity', 'blue-chip', 'discovery'].map(machineBySlug)) {
      for (const tier of machine!.tiers) {
        const min = Number.parseFloat(tier.minAmount)
        const max = Number.parseFloat(tier.maxAmount)
        expect(min).toBeGreaterThan(0)
        expect(max).toBeGreaterThanOrEqual(min)
      }
    }
  })

  /**
   * Scoped to machines that can actually be published.
   *
   * `pnpm operator machines` skips disabled machines, so their tables never reach the chain.
   * A disabled machine may therefore reference an asset that has since lost eligibility —
   * Genesis does, after cirBTC dropped out at block 22,258,137 — and that is a table to
   * rebuild before re-enabling it, not a live defect.
   *
   * The assertion still binds on everything publishable, which is where it matters: a live
   * machine must never pay a token the registry has not verified.
   */
  it('every publishable machine pays only verified assets', () => {
    const verified = new Set(REWARD_ASSETS.map((a) => a.address.toLowerCase()))
    const publishable = MACHINES.filter((m) => m.status !== 'disabled')
    expect(publishable.length).toBeGreaterThan(0)
    for (const machine of publishable) {
      for (const tier of machine.tiers) {
        expect(
          verified.has(tier.token.toLowerCase()),
          `${tier.token} on ${machine.slug} must be a verified asset`,
        ).toBe(true)
      }
    }
  })

  it('any machine carrying an unverified token is disabled', () => {
    // Stated from the other direction to the test above, and deliberately not pinned to a
    // list of slugs: token eligibility moves as liquidity, volume and age move, so naming
    // which machines are currently stale made this fail whenever the registry was re-run.
    // What must never change is that a stale table cannot be published.
    const verified = new Set(REWARD_ASSETS.map((a) => a.address.toLowerCase()))
    const stale = MACHINES.filter((m) =>
      m.tiers.some((t) => !verified.has(t.token.toLowerCase())),
    )
    for (const machine of stale) {
      expect(machine.status, `${machine.slug} pays an unverified token and must be disabled`).toBe(
        'disabled',
      )
    }
  })
})

describe('evaluateMachine', () => {
  it('reports EV as unknown rather than guessing when prices are missing', () => {
    const result = evaluateMachine(genesis(), NO_PRICES)
    expect(result.expectedPayoutUsd).toBeNull()
    expect(result.payoutRatio).toBeNull()
    expect(result.findings.some((f) => f.code === 'prices-unknown')).toBe(true)
    // Unknown prices are a warning, never a blocker: the onchain guard works in token units.
    expect(result.findings.find((f) => f.code === 'prices-unknown')?.blocking).toBe(false)
  })

  it('blocks a machine whose expected payout exceeds spin revenue', () => {
    const machine: MachineConfig = {
      ...genesis(),
      slug: 'ruinous',
      spinPriceUsdc: '2',
      tiers: [
        {
          token: REWARD_ASSETS[0]!.address,
          weight: 10_000,
          rarity: 'common',
          // At $0.01 each, a guaranteed 1,000 units costs $10 against $2 of revenue.
          minAmount: '1000',
          maxAmount: '1000',
        },
      ],
    }

    const result = evaluateMachine(machine, FULL_PRICES)
    expect(result.payoutRatio).toBeGreaterThan(1)
    expect(result.risk).toBe('critical')
    expect(result.blocking.some((f) => f.code === 'negative-margin')).toBe(true)
  })

  it('blocks a machine above the payout ceiling even when it is still profitable', () => {
    const asset = REWARD_ASSETS[0]!
    // 90% of a $2 spin is $1.80 => 180 units at $0.01.
    const machine: MachineConfig = {
      ...genesis(),
      slug: 'thin',
      spinPriceUsdc: '2',
      tiers: [
        {token: asset.address, weight: 10_000, rarity: 'common', minAmount: '180', maxAmount: '180'},
      ],
    }

    const result = evaluateMachine(machine, FULL_PRICES)
    expect(result.payoutRatio).toBeCloseTo(0.9, 6)
    expect(result.payoutRatio!).toBeGreaterThan(SAFETY.maxPayoutRatio)
    expect(result.marginUsd!).toBeGreaterThan(0) // still profitable...
    expect(result.blocking.some((f) => f.code === 'payout-over-ceiling')).toBe(true) // ...but blocked
  })

  it('accepts a machine comfortably inside the ceiling', () => {
    const asset = REWARD_ASSETS[0]!
    // 30% of a $2 spin.
    const machine: MachineConfig = {
      ...genesis(),
      slug: 'healthy',
      spinPriceUsdc: '2',
      tiers: [
        {token: asset.address, weight: 10_000, rarity: 'common', minAmount: '60', maxAmount: '60'},
      ],
    }

    const inventory = {[asset.address.toLowerCase()]: 1_000_000}
    const result = evaluateMachine(machine, FULL_PRICES, inventory)
    expect(result.blocking).toHaveLength(0)
    expect(result.risk).toBe('ok')
  })

  it('computes worst-case liability the same way the contract does', () => {
    const asset = REWARD_ASSETS[0]!
    const machine: MachineConfig = {
      ...genesis(),
      slug: 'liability',
      tiers: [
        {token: asset.address, weight: 9_000, rarity: 'common', minAmount: '1', maxAmount: '10'},
        // A second tier on the same token with a larger max must dominate.
        {token: asset.address, weight: 1_000, rarity: 'jackpot', minAmount: '50', maxAmount: '500'},
      ],
    }

    const result = evaluateMachine(machine, NO_PRICES)
    const liability = result.liabilities.find(
      (l) => l.address === asset.address.toLowerCase(),
    )
    expect(liability).toBeDefined()
    // Worst case is the largest maxAmount across tiers paying that token — not the sum.
    expect(liability!.worstCasePerSpin).toBe(500)
    expect(liability!.worstCaseTotal).toBe(500 * SAFETY.assumedConcurrentSpins)
  })

  it('blocks activation when inventory cannot cover concurrent worst cases', () => {
    const asset = REWARD_ASSETS[0]!
    const machine: MachineConfig = {
      ...genesis(),
      slug: 'short',
      tiers: [
        {token: asset.address, weight: 1, rarity: 'common', minAmount: '100', maxAmount: '100'},
      ],
    }

    // Enough for 5 worst-case spins, but the check assumes 10 concurrent.
    const inventory = {[asset.address.toLowerCase()]: 500}
    const result = evaluateMachine(machine, NO_PRICES, inventory)
    expect(result.blocking.some((f) => f.code === 'inventory-short')).toBe(true)
  })

  it('warns on short runway without blocking', () => {
    const asset = REWARD_ASSETS[0]!
    const machine: MachineConfig = {
      ...genesis(),
      slug: 'runway',
      tiers: [
        {token: asset.address, weight: 1, rarity: 'common', minAmount: '100', maxAmount: '100'},
      ],
    }

    // Covers the 10 concurrent worst cases, but only 15 spins of runway (< minRunwaySpins).
    const inventory = {[asset.address.toLowerCase()]: 1_500}
    const result = evaluateMachine(machine, NO_PRICES, inventory)
    expect(result.blocking.some((f) => f.code === 'inventory-short')).toBe(false)
    expect(result.findings.some((f) => f.code === 'runway-short')).toBe(true)
  })

  it('blocks a token that is not in the verified registry', () => {
    const machine: MachineConfig = {
      ...genesis(),
      slug: 'unverified',
      tiers: [
        {
          token: '0x000000000000000000000000000000000000dead',
          weight: 1,
          rarity: 'common',
          minAmount: '1',
          maxAmount: '1',
        },
      ],
    }

    const result = evaluateMachine(machine, NO_PRICES)
    expect(result.blocking.some((f) => f.code === 'unverified-token')).toBe(true)
  })

  it('blocks an empty reward table', () => {
    const machine: MachineConfig = {...genesis(), slug: 'empty', tiers: []}
    const result = evaluateMachine(machine, NO_PRICES)
    expect(result.blocking.some((f) => f.code === 'empty-table')).toBe(true)
  })

  it('every publishable machine passes when inventory is ample', () => {
    const inventory = Object.fromEntries(
      REWARD_ASSETS.map((a) => [a.address.toLowerCase(), 1e12]),
    )
    // Disabled machines are excluded for the same reason as above: they cannot be published,
    // and Genesis, Velocity and Blue Chip all still list cirBTC, which lost eligibility.
    for (const {slug} of MACHINES.filter((m) => m.status !== 'disabled')) {
      const result = evaluateMachine(machineBySlug(slug)!, NO_PRICES, inventory)
      // Without prices EV is unknown, so only structural findings should appear.
      expect(result.blocking, `${slug} should have no blocking findings`).toHaveLength(0)
    }
  })
})

describe('formatUnitsShort', () => {
  it('keeps small-denomination assets legible instead of rounding to zero', () => {
    // A cirBTC reward must not render as "0.00".
    expect(formatUnitsShort(0.00043)).not.toBe('0.00')
    expect(Number.parseFloat(formatUnitsShort(0.00043))).toBeCloseTo(0.00043, 6)
  })

  it('compacts large amounts', () => {
    expect(formatUnitsShort(1_500_000)).toBe('1.50M')
    expect(formatUnitsShort(2_400)).toBe('2.40K')
  })

  it('handles zero and non-finite input', () => {
    expect(formatUnitsShort(0)).toBe('0')
    expect(formatUnitsShort(Number.NaN)).toBe('—')
    expect(formatUnitsShort(Number.POSITIVE_INFINITY)).toBe('—')
  })
})
