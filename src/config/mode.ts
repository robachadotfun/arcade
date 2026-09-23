import {ARC_MAINNET_ID, ARC_TESTNET_ID, type ArcChainId} from './network'
import {FALLBACK_MODE, KNOWN_DEPLOYMENTS} from './deployments'

/**
 * Arcade runs against a real Arc network, chosen by `NEXT_PUBLIC_ARCADE_MODE`.
 *
 * There is no demo, simulation or offline mode, and adding one back would be a mistake. Every
 * outcome this product shows is decided by the machine manager contract and read back from
 * chain state. There is no code path that can invent one.
 *
 * The consequence is that Arcade needs a deployment to do anything, and says so plainly when
 * it does not have one: {@link resolveMode} returns `misconfigured` listing exactly which
 * environment variables are missing, and the UI refuses to offer spins. That refusal is the
 * feature. A player must never see an outcome that did not happen onchain.
 *
 * Addresses come from the environment first and, failing that, from the deployment manifest
 * in `deployments.ts` — a specific, verified deployment checked into the repository so a host
 * that builds without environment variables still reaches the right contracts. The manifest
 * never crosses networks: see that file for why.
 */

export type ArcadeMode = 'testnet' | 'mainnet'

export type ModeStatus =
  | {kind: 'ready'; mode: ArcadeMode; chainId: ArcChainId; contracts: ArcadeContracts}
  /** `mode` is null when `NEXT_PUBLIC_ARCADE_MODE` itself is unset or unrecognised. */
  | {kind: 'misconfigured'; mode: ArcadeMode | null; missing: string[]}

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

/**
 * The configured network.
 *
 * Falls back to the network of the committed deployment manifest. That is not a guess about
 * what the operator meant — it is the deployment they checked in. With no manifest entry the
 * fallback is null and an unconfigured build stays inert and loud, as before.
 */
export function rawMode(): ArcadeMode | null {
  const raw = process.env.NEXT_PUBLIC_ARCADE_MODE?.toLowerCase()
  if (raw === 'mainnet' || raw === 'testnet') return raw
  return FALLBACK_MODE
}

export const MODE_ENV = 'NEXT_PUBLIC_ARCADE_MODE'

const CONTRACT_ENV: Array<[keyof ArcadeContracts, string]> = [
  ['machineManager', 'NEXT_PUBLIC_ARCADE_MACHINE_MANAGER'],
  ['prizeVault', 'NEXT_PUBLIC_ARCADE_PRIZE_VAULT'],
  ['rewardRegistry', 'NEXT_PUBLIC_ARCADE_REWARD_REGISTRY'],
  ['randomness', 'NEXT_PUBLIC_ARCADE_RANDOMNESS'],
  ['feeRouter', 'NEXT_PUBLIC_ARCADE_FEE_ROUTER'],
]

/**
 * Resolves the network and its contracts, validating that everything is present.
 *
 * Next inlines `NEXT_PUBLIC_*` at build time by matching the literal text `process.env.X`, so
 * each variable is read through an explicit property access below rather than a computed
 * lookup. A loop over names would read `undefined` in the browser.
 */
export function resolveMode(): ModeStatus {
  const mode = rawMode()

  // Keyed by the resolved network, so a testnet build never inherits mainnet addresses.
  const fallback = mode === null ? undefined : KNOWN_DEPLOYMENTS[mode]

  const values: Record<keyof ArcadeContracts, string | undefined> = {
    machineManager: process.env.NEXT_PUBLIC_ARCADE_MACHINE_MANAGER ?? fallback?.machineManager,
    prizeVault: process.env.NEXT_PUBLIC_ARCADE_PRIZE_VAULT ?? fallback?.prizeVault,
    rewardRegistry: process.env.NEXT_PUBLIC_ARCADE_REWARD_REGISTRY ?? fallback?.rewardRegistry,
    randomness: process.env.NEXT_PUBLIC_ARCADE_RANDOMNESS ?? fallback?.randomness,
    feeRouter: process.env.NEXT_PUBLIC_ARCADE_FEE_ROUTER ?? fallback?.feeRouter,
  }

  const missing: string[] = []
  const resolved: Partial<ArcadeContracts> = {}

  if (mode === null) missing.push(MODE_ENV)

  for (const [key, envName] of CONTRACT_ENV) {
    const address = readAddress(values[key])
    if (!address) {
      missing.push(envName)
    } else {
      resolved[key] = address
    }
  }

  if (mode === null || missing.length > 0) {
    return {kind: 'misconfigured', mode, missing}
  }

  return {
    kind: 'ready',
    mode,
    chainId: mode === 'mainnet' ? ARC_MAINNET_ID : ARC_TESTNET_ID,
    contracts: resolved as ArcadeContracts,
  }
}

export const MODE_LABEL: Record<ArcadeMode, string> = {
  testnet: 'Arc Testnet',
  mainnet: 'Arc Mainnet',
}

export const MODE_DESCRIPTION: Record<ArcadeMode, string> = {
  testnet: 'Real transactions on Arc Testnet using test-only contracts and test-only assets.',
  mainnet: 'Real transactions on Arc Mainnet. Spins cost real USDC.',
}

/** Label for a mode that may not be configured yet. */
export function modeLabel(mode: ArcadeMode | null): string {
  return mode === null ? 'Not configured' : MODE_LABEL[mode]
}
