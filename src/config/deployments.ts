import type {ArcadeMode} from './mode'

/**
 * Deployments checked into the repository.
 *
 * ## Why this exists
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so a host that builds without them
 * produces a bundle that can never reach a contract — the site renders "not connected to a
 * deployment" no matter what the chain says. That is the correct behaviour when nobody has
 * said which deployment to use. It is unhelpful when the answer is already known and public.
 *
 * These addresses are not a guess or a placeholder. They are a specific deployment, recorded
 * here deliberately, and every one was read back from Arc Mainnet before being written down:
 * each contract holds code, the manager points at the other four, `isSettler` and
 * `isConsumer` are both true, and machine 1 exists at version 1.
 *
 * ## Precedence
 *
 * Environment variables always win. This is the fallback, not the default in the sense of
 * overriding anything — set `NEXT_PUBLIC_ARCADE_*` and the manifest is ignored entirely,
 * which is how you point a build at a different deployment without editing source.
 *
 * ## The one rule
 *
 * A manifest entry is keyed by network and only ever applies to its own network. Building
 * with `NEXT_PUBLIC_ARCADE_MODE=testnet` does **not** fall back to the mainnet entry — it
 * reports itself misconfigured, because silently pointing a testnet build at real contracts
 * holding real inventory is precisely the accident this file must not cause.
 *
 * ## Keeping it honest
 *
 * If this deployment is ever replaced, update or delete this entry in the same change that
 * replaces it. A stale manifest is worse than none: it would send players at abandoned
 * contracts while looking perfectly configured.
 */

export type Deployment = {
  machineManager: `0x${string}`
  prizeVault: `0x${string}`
  rewardRegistry: `0x${string}`
  randomness: `0x${string}`
  feeRouter: `0x${string}`
  /** `slug:id` pairs, same format as NEXT_PUBLIC_ARCADE_MACHINE_IDS. */
  machineIds: string
  /** Provenance, so the entry can be re-checked rather than trusted. */
  verifiedAtBlock: number
  verifiedOn: string
}

export const KNOWN_DEPLOYMENTS: Partial<Record<ArcadeMode, Deployment>> = {
  mainnet: {
    machineManager: '0x69c4aa34cB47Dc4d0E6d4a39C39F7278B333AAB7',
    prizeVault: '0x13041baE3da3616E432314D3e0F562b87aF66E55',
    rewardRegistry: '0xE639aD6D6e81c997AC043cc7dac95d7223aF7fE0',
    randomness: '0x51CE8402d868a6d41730B42079502a94b519E373',
    feeRouter: '0x47Ff72f5015517348c28B35900bD30aC5bc52A9A',
    machineIds: 'discovery:1',
    verifiedAtBlock: 22_262_501,
    verifiedOn: '2026-09-23',
  },
}

/**
 * The network a build targets when `NEXT_PUBLIC_ARCADE_MODE` is unset.
 *
 * Deliberately derived from the manifest rather than hardcoded: it is only non-null because
 * a deployment was committed above, so deleting that entry returns the app to refusing to
 * run unconfigured instead of leaving a dangling default pointing at nothing.
 */
export const FALLBACK_MODE: ArcadeMode | null =
  KNOWN_DEPLOYMENTS.mainnet ? 'mainnet' : KNOWN_DEPLOYMENTS.testnet ? 'testnet' : null
