/**
 * @vitest-environment node
 */
import {describe, expect, it, beforeAll} from 'vitest'
import {webcrypto} from 'node:crypto'
import {drawDemoIndex, drawDemoOutcome, assetIndexForOutcome} from './demoOutcome'
import {machineBySlug, rarityOdds, type MachineConfig} from '@/config/machines'

/**
 * Demo outcomes are the one place in the codebase that generates a result rather than
 * reading one. These tests prove two things: the distribution matches the published odds
 * (so the demo is an honest preview, not a flattering one), and every result is flagged as
 * simulated so it can never be mistaken for a real spin.
 */

beforeAll(() => {
  // `crypto.getRandomValues` is available in the browser and in modern Node; make sure the
  // global exists under the node test environment.
  if (typeof globalThis.crypto === 'undefined') {
    Object.defineProperty(globalThis, 'crypto', {value: webcrypto})
  }
})

function genesis(): MachineConfig {
  const machine = machineBySlug('genesis')
  if (!machine) throw new Error('genesis machine missing')
  return machine
}

describe('drawDemoIndex', () => {
  it('stays within bounds', () => {
    for (let i = 0; i < 500; i += 1) {
      const index = drawDemoIndex(7)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(7)
    }
  })

  it('handles a degenerate length without throwing', () => {
    expect(drawDemoIndex(0)).toBe(0)
    expect(drawDemoIndex(1)).toBe(0)
  })

  it('is not constant', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 200; i += 1) seen.add(drawDemoIndex(10))
    expect(seen.size).toBeGreaterThan(3)
  })
})

describe('drawDemoOutcome', () => {
  it('always marks the result as simulated', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(drawDemoOutcome(genesis()).simulated).toBe(true)
    }
  })

  it('prefixes the id so it cannot be mistaken for an onchain spin id', () => {
    const outcome = drawDemoOutcome(genesis())
    expect(outcome.demoSpinId.startsWith('demo-')).toBe(true)
    // An onchain spin id is a plain decimal; this must never parse as one.
    expect(/^[0-9]+$/.test(outcome.demoSpinId)).toBe(false)
  })

  it('always lands inside the published band for the chosen tier', () => {
    const machine = genesis()
    for (let i = 0; i < 2_000; i += 1) {
      const outcome = drawDemoOutcome(machine)
      const min = Number.parseFloat(outcome.tier.minAmount)
      const max = Number.parseFloat(outcome.tier.maxAmount)
      expect(outcome.amount).toBeGreaterThanOrEqual(min)
      expect(outcome.amount).toBeLessThanOrEqual(max)
    }
  })

  it('resolves a verified asset for every tier', () => {
    const machine = genesis()
    for (let i = 0; i < 200; i += 1) {
      expect(drawDemoOutcome(machine).asset).toBeDefined()
    }
  })

  it('tracks the published rarity distribution', () => {
    const machine = genesis()
    const expected = new Map(rarityOdds(machine).map((band) => [band.rarity, band.probability]))
    const counts = new Map<string, number>()
    const samples = 30_000

    for (let i = 0; i < samples; i += 1) {
      const {rarity} = drawDemoOutcome(machine)
      counts.set(rarity, (counts.get(rarity) ?? 0) + 1)
    }

    for (const [rarity, probability] of expected) {
      const observed = (counts.get(rarity) ?? 0) / samples
      // Tolerance is generous: this asserts the mapping is unbiased, not that the CSPRNG is
      // perfect. 1.5 percentage points is far outside sampling noise at n=30,000.
      expect(Math.abs(observed - probability), `${rarity} share`).toBeLessThan(0.015)
    }
  })
})

describe('assetIndexForOutcome', () => {
  it('returns an index into the machine’s deduplicated asset list', () => {
    const machine = genesis()
    const uniqueTokens = new Set(machine.tiers.map((t) => t.token.toLowerCase()))
    for (let i = 0; i < 200; i += 1) {
      const outcome = drawDemoOutcome(machine)
      const index = assetIndexForOutcome(machine, outcome)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(uniqueTokens.size)
    }
  })
})
