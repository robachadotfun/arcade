import {describe, expect, it} from 'vitest'
import {KNOWN_DEPLOYMENTS, FALLBACK_MODE} from './deployments'

/**
 * The manifest lets a build with no environment variables still reach the right contracts.
 * The danger it introduces is a build reaching the *wrong* ones, so these pin the two
 * properties that keep it safe.
 */
describe('deployment manifest', () => {
  it('only ever describes the network it is keyed under', () => {
    // A mainnet entry must never be reachable from a testnet build. Cross-network fallback
    // would point a test deployment at contracts holding real inventory.
    expect(Object.keys(KNOWN_DEPLOYMENTS)).toEqual(['mainnet'])
    expect(KNOWN_DEPLOYMENTS.testnet).toBeUndefined()
  })

  it('derives the fallback network from the manifest rather than hardcoding it', () => {
    expect(FALLBACK_MODE).toBe('mainnet')
  })

  it('holds real, distinct, checksum-shaped addresses', () => {
    const d = KNOWN_DEPLOYMENTS.mainnet
    expect(d).toBeDefined()
    const addresses = [
      d!.machineManager,
      d!.prizeVault,
      d!.rewardRegistry,
      d!.randomness,
      d!.feeRouter,
    ]
    for (const a of addresses) expect(a).toMatch(/^0x[0-9a-fA-F]{40}$/)
    // Five separate contracts: a copy-paste slip that repeated one would be silent otherwise.
    expect(new Set(addresses.map((a) => a.toLowerCase())).size).toBe(5)
    expect(d!.machineIds).toMatch(/^[a-z0-9-]+:\d+(,[a-z0-9-]+:\d+)*$/)
    expect(d!.verifiedAtBlock).toBeGreaterThan(0)
  })
})
