import {ARC_MAINNET_ID, ARC_TESTNET_ID, type ArcChainId} from './network'

/**
 * Arcade runs in one of three modes, chosen by `NEXT_PUBLIC_ARCADE_MODE`.
 *
 * The rule that matters: **mainnet never silently degrades to demo.** If mainnet is
 * selected but the required contract addresses are missing, {@link resolveMode} returns a
 * `misconfigured` mode and the UI refuses to offer spins rather than quietly simulating
 * them. A player must never see a fake outcome while believing it is real.
 */

export type ArcadeMode = 'demo' | 'testnet' | 'mainnet'

export type ModeStatus =
  | {kind: 'ready'; mode: ArcadeMode; chainId: ArcChainId | null; contracts: ArcadeContracts}
  | {kind: 'misconfigured'; mode: ArcadeMode; missing: string[]}

export type ArcadeContracts = {
  machineManager: `0x${string}`
  prizeVault: `0x${string}`
  rewardRegistry: `0x${string}`
  randomness: `0x${string}`
  feeRouter: `0x${string}`
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

function readAddress(value: string | undefined): `0x${string}` | null {
  if (!value || !ADDRESS_PATTERN.test(value)) return null
  return value as `0x${string}`
}

export function rawMode(): ArcadeMode {
  const raw = process.env.NEXT_PUBLIC_ARCADE_MODE?.toLowerCase()
  if (raw === 'mainnet' || raw === 'testnet' || raw === 'demo') return raw
  // Default to demo: the safest failure is one that cannot touch real funds.
  return 'demo'
}

/**
 * Resolves the effective mode, validating that everything a live mode needs is present.
 */
export function resolveMode(): ModeStatus {
  const mode = rawMode()

  if (mode === 'demo') {
    return {kind: 'ready', mode, chainId: null, contracts: DEMO_CONTRACTS}
  }

  const chainId: ArcChainId = mode === 'mainnet' ? ARC_MAINNET_ID : ARC_TESTNET_ID

  const entries: Array<[keyof ArcadeContracts, string, string | undefined]> = [
    ['machineManager', 'NEXT_PUBLIC_ARCADE_MACHINE_MANAGER', process.env.NEXT_PUBLIC_ARCADE_MACHINE_MANAGER],
    ['prizeVault', 'NEXT_PUBLIC_ARCADE_PRIZE_VAULT', process.env.NEXT_PUBLIC_ARCADE_PRIZE_VAULT],
    ['rewardRegistry', 'NEXT_PUBLIC_ARCADE_REWARD_REGISTRY', process.env.NEXT_PUBLIC_ARCADE_REWARD_REGISTRY],
    ['randomness', 'NEXT_PUBLIC_ARCADE_RANDOMNESS', process.env.NEXT_PUBLIC_ARCADE_RANDOMNESS],
    ['feeRouter', 'NEXT_PUBLIC_ARCADE_FEE_ROUTER', process.env.NEXT_PUBLIC_ARCADE_FEE_ROUTER],
  ]

  const missing: string[] = []
  const resolved: Partial<ArcadeContracts> = {}

  for (const [key, envName, value] of entries) {
    const address = readAddress(value)
    if (!address) {
      missing.push(envName)
    } else {
      resolved[key] = address
    }
  }

  if (missing.length > 0) {
    // Deliberately NOT falling back to demo. A misconfigured live mode is an error state
    // the operator has to see and fix, not something to paper over with simulated spins.
    return {kind: 'misconfigured', mode, missing}
  }

  return {kind: 'ready', mode, chainId, contracts: resolved as ArcadeContracts}
}

/**
 * Placeholder addresses used only in demo mode, where no contract is ever called. They are
 * obviously non-real so they cannot be mistaken for a deployment.
 */
export const DEMO_CONTRACTS: ArcadeContracts = {
  machineManager: '0x0000000000000000000000000000000000000dEm0',
  prizeVault: '0x0000000000000000000000000000000000000dEm1',
  rewardRegistry: '0x0000000000000000000000000000000000000dEm2',
  randomness: '0x0000000000000000000000000000000000000dEm3',
  feeRouter: '0x0000000000000000000000000000000000000dEm4',
}

export const MODE_LABEL: Record<ArcadeMode, string> = {
  demo: 'Demo',
  testnet: 'Arc Testnet',
  mainnet: 'Arc Mainnet',
}

export const MODE_DESCRIPTION: Record<ArcadeMode, string> = {
  demo: 'Simulated outcomes. No wallet required, no funds move, nothing is settled onchain.',
  testnet: 'Real transactions on Arc Testnet using test-only contracts and test-only assets.',
  mainnet: 'Real transactions on Arc Mainnet. Spins cost real USDC.',
}

/** True when a mode can actually move value. Gates every irreversible UI affordance. */
export function isLiveMode(mode: ArcadeMode): boolean {
  return mode === 'mainnet' || mode === 'testnet'
}
