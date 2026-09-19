import {assetByAddress, type RewardAsset} from './rewards'

/**
 * Machine templates and the reward tables that define their economics.
 *
 * ## These are DEMO CONFIGURATIONS
 *
 * The weights and reward bands below exist so a fresh checkout has coherent, honest
 * numbers to render and so the EV calculator has something to chew on. They are **not**
 * production economics. In testnet or mainnet mode the UI reads machines, versions and
 * reward tables from `ArcadeMachineManager` onchain, and these values are ignored.
 *
 * A production reward table is published by `publishVersion`, which seals it immutably and
 * records a config hash. That hash — not this file — is what a player verifies against.
 */

export type Rarity = 'common' | 'rare' | 'ultra' | 'jackpot'

/** Contract enum order in ArcadeMachineManager.Rarity. Do not reorder. */
export const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'ultra', 'jackpot']

export type RewardTierConfig = {
  /** Reward asset address. Must exist in the verified reward registry. */
  token: `0x${string}`
  /** Relative probability weight. Odds are weight / totalWeight. */
  weight: number
  rarity: Rarity
  /** Reward bounds in the token's own decimals, as a decimal string. */
  minAmount: string
  maxAmount: string
}

export type MachineConfig = {
  slug: string
  /** Onchain machine id, once deployed. Null until a machine is created. */
  onchainId: number | null
  name: string
  tagline: string
  description: string
  /** Spin price in native USDC (18 decimals on Arc). */
  spinPriceUsdc: string
  status: 'live' | 'paused' | 'disabled'
  tiers: RewardTierConfig[]
}

const ARGUS = '0xece5ca8bf9220718e5727754026757512212cb3c' as const
const TOLLY = '0xbc43ce8dec648ea298c4275559b81d6261c90b67' as const
const COOL = '0xeb64987643db71c76b2a2be7e723decc995e5b37' as const
const ARCAT = '0x07704b06981ea962b87296362a1281484d160000' as const
const LONG = '0x2164bb17a2d38c1b5170e987b2c0416df1efc752' as const
const CRCL = '0x2ba0f44bdfc17fba30eda9cdbecb908ca45b043b' as const
const CIRBTC = '0x171a4217b86a807a64eb94757db6849fb4bdbaa0' as const
const WETH = '0x128cc466b61f542da60c70e3aa11c10e19b84edb' as const
const EURC = '0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1' as const
const VIRTUAL = '0x8c4252c87081c88c6ad57d6dd97e1cafebf842b7' as const
const ARCT = '0x1ea1e4f9a9975f1f6e9c0a9f6e8ada7a66e6de52' as const
const ARCX10 = '0x12ce1f970722ca6e08364b60099b3d25c09b5434' as const
const ARCBAT = '0xbe0cad585ea2d13de2f4e36376be755c0afd8b97' as const

export const MACHINES: MachineConfig[] = [
  {
    slug: 'genesis',
    onchainId: null,
    name: 'Genesis',
    tagline: 'Arc Mainnet mix',
    description:
      'The broad one. Established Arc assets across four rarity bands, weighted toward frequent small wins.',
    spinPriceUsdc: '2',
    status: 'live',
    tiers: [
      {token: ARGUS, weight: 4200, rarity: 'common', minAmount: '120', maxAmount: '420'},
      {token: TOLLY, weight: 2800, rarity: 'common', minAmount: '180', maxAmount: '640'},
      {token: COOL, weight: 1500, rarity: 'rare', minAmount: '900', maxAmount: '2600'},
      {token: ARCAT, weight: 900, rarity: 'rare', minAmount: '3200', maxAmount: '9800'},
      {token: CRCL, weight: 400, rarity: 'ultra', minAmount: '0.08', maxAmount: '0.24'},
      {token: CIRBTC, weight: 150, rarity: 'ultra', minAmount: '0.00012', maxAmount: '0.00045'},
      {token: WETH, weight: 50, rarity: 'jackpot', minAmount: '0.004', maxAmount: '0.014'},
    ],
  },
  {
    slug: 'velocity',
    onchainId: null,
    name: 'Velocity',
    tagline: 'High-activity assets',
    description:
      'Narrower set, tilted toward the assets trading hardest on Arc right now. Bigger swings in both directions.',
    spinPriceUsdc: '3',
    status: 'live',
    tiers: [
      {token: ARGUS, weight: 3800, rarity: 'common', minAmount: '200', maxAmount: '680'},
      {token: LONG, weight: 3000, rarity: 'common', minAmount: '700', maxAmount: '2200'},
      {token: TOLLY, weight: 2000, rarity: 'rare', minAmount: '420', maxAmount: '1300'},
      {token: VIRTUAL, weight: 900, rarity: 'ultra', minAmount: '2.4', maxAmount: '7.5'},
      {token: CIRBTC, weight: 250, rarity: 'ultra', minAmount: '0.0002', maxAmount: '0.0006'},
      {token: WETH, weight: 50, rarity: 'jackpot', minAmount: '0.008', maxAmount: '0.026'},
    ],
  },
  {
    slug: 'blue-chip',
    onchainId: null,
    name: 'Blue Chip',
    tagline: 'Deep-liquidity only',
    description:
      'The smallest reward set and the largest bands. Only assets with the deepest liquidity on Arc.',
    spinPriceUsdc: '5',
    status: 'live',
    tiers: [
      {token: CIRBTC, weight: 4500, rarity: 'common', minAmount: '0.00028', maxAmount: '0.00085'},
      {token: WETH, weight: 3000, rarity: 'common', minAmount: '0.009', maxAmount: '0.028'},
      {token: EURC, weight: 1800, rarity: 'rare', minAmount: '1.6', maxAmount: '5.2'},
      {token: ARGUS, weight: 600, rarity: 'ultra', minAmount: '900', maxAmount: '2800'},
      {token: WETH, weight: 100, rarity: 'jackpot', minAmount: '0.05', maxAmount: '0.16'},
    ],
  },
  {
    slug: 'discovery',
    onchainId: null,
    name: 'Discovery',
    tagline: 'Rotating emerging assets',
    description:
      'Newer Arc assets that still cleared every contract check. Rotates as the network moves. Higher risk, stated plainly.',
    spinPriceUsdc: '2',
    status: 'live',
    tiers: [
      {token: ARCT, weight: 3600, rarity: 'common', minAmount: '2800', maxAmount: '9000'},
      {token: ARCX10, weight: 3000, rarity: 'common', minAmount: '1600', maxAmount: '5200'},
      {token: ARCBAT, weight: 2200, rarity: 'rare', minAmount: '3200', maxAmount: '9600'},
      {token: ARCAT, weight: 1000, rarity: 'ultra', minAmount: '9000', maxAmount: '28000'},
      {token: CRCL, weight: 200, rarity: 'jackpot', minAmount: '0.18', maxAmount: '0.55'},
    ],
  },
  {
    slug: 'machine-zero',
    onchainId: null,
    name: 'Machine Zero',
    tagline: 'Experimental',
    description:
      'Where new mechanics get tested before they reach a live machine. Disabled by default.',
    spinPriceUsdc: '2',
    status: 'disabled',
    tiers: [{token: ARGUS, weight: 10000, rarity: 'common', minAmount: '100', maxAmount: '100'}],
  },
]

export function machineBySlug(slug: string): MachineConfig | undefined {
  return MACHINES.find((m) => m.slug === slug)
}

export const LIVE_MACHINES = MACHINES.filter((m) => m.status === 'live')

// ---------------------------------------------------------------------------- odds

export type RarityOdds = {
  rarity: Rarity
  weight: number
  probability: number
}

export function totalWeight(machine: MachineConfig): number {
  return machine.tiers.reduce((sum, t) => sum + t.weight, 0)
}

/** Probability per rarity band, summing to 1. */
export function rarityOdds(machine: MachineConfig): RarityOdds[] {
  const total = totalWeight(machine)
  return RARITY_ORDER.map((rarity) => {
    const weight = machine.tiers
      .filter((t) => t.rarity === rarity)
      .reduce((sum, t) => sum + t.weight, 0)
    return {rarity, weight, probability: total === 0 ? 0 : weight / total}
  }).filter((o) => o.weight > 0)
}

/** Per-tier probability, for the full published odds table. */
export function tierOdds(machine: MachineConfig) {
  const total = totalWeight(machine)
  return machine.tiers.map((tier) => ({
    tier,
    asset: assetByAddress(tier.token),
    probability: total === 0 ? 0 : tier.weight / total,
  }))
}

/**
 * A stable config fingerprint for the demo tables.
 *
 * In a live mode the authoritative hash is the `configHash` that `publishVersion` computed
 * onchain. This is only so demo mode can show a real, reproducible identifier rather than
 * a made-up one.
 */
export function demoConfigFingerprint(machine: MachineConfig): string {
  const canonical = JSON.stringify({
    slug: machine.slug,
    price: machine.spinPriceUsdc,
    tiers: machine.tiers.map((t) => [t.token, t.weight, t.rarity, t.minAmount, t.maxAmount]),
  })
  // FNV-1a — deterministic, dependency-free, and clearly labelled as a demo fingerprint.
  let hash = 0x811c9dc5
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `demo-${hash.toString(16).padStart(8, '0')}`
}

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  rare: 'Rare',
  ultra: 'Ultra',
  jackpot: 'Jackpot',
}

export function assetsOnMachine(machine: MachineConfig): RewardAsset[] {
  const seen = new Set<string>()
  const out: RewardAsset[] = []
  for (const tier of machine.tiers) {
    const key = tier.token.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const asset = assetByAddress(tier.token)
    if (asset) out.push(asset)
  }
  return out
}
