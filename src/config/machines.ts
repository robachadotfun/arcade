import {assetByAddress, type RewardAsset} from './rewards'
import {FALLBACK_MODE, KNOWN_DEPLOYMENTS} from './deployments'

/**
 * Machine templates and the reward tables that define their economics.
 *
 * ## This file is the proposal; the chain is the truth
 *
 * The weights and reward bands below are what an operator intends to publish. They are the
 * input to `scripts/setup-arcade.ts`, which calls `publishVersion` to seal them onchain.
 * Once sealed, the contract's own `configHash` is the authoritative identity of a reward
 * table, and it is what the UI displays and what a player verifies against — never this file.
 *
 * If these values and the chain ever disagree, the chain is right and this file is stale.
 * Nothing here is used to decide an outcome, compute a payout or render a result: the spin
 * path reads the table from `ArcadeMachineManager`.
 *
 * ## Onchain ids
 *
 * `onchainId` is resolved from `NEXT_PUBLIC_ARCADE_MACHINE_IDS` (`slug:id`, comma separated),
 * which the setup script prints after it creates the machines. It is env-driven rather than
 * edited into this file so that deploying does not require a source change and a rebuild of
 * the repository itself.
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
  /**
   * Onchain machine id. Null until the machine has been created onchain and its id mapped
   * in `NEXT_PUBLIC_ARCADE_MACHINE_IDS`. A machine with no id cannot be spun.
   */
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
/** UpSideDownCat. On-chain ticker is USDC; shown to players as UDCAT. See rewards.ts. */
const UDCAT = '0x8e98a62a995a50eca9979bfa016f91bf36a8f9d9' as const
const TOLLY = '0xbc43ce8dec648ea298c4275559b81d6261c90b67' as const
/**
 * Beancat. Verified clean at block 22,258,137: zero fee, standard bool return.
 *
 * Retired from Discovery on 2026-09-29 — 24h volume had fallen to roughly $530, an order of
 * magnitude below the next weakest reward. Kept here rather than deleted so re-admission is a
 * one-line change if its market recovers, and so the address stays in one place if it does.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- retired, kept for re-admission
const BCAT = '0x258bbb25fb1bc34c87212f8dab34838854ef2d5d' as const
/**
 * $ARCADE, the project's own token. Admitted as a reward by operator decision despite
 * failing the market thresholds — see ADMITTED_DISCLOSURES in rewards.ts, which publishes
 * that admission and its reasons on /rewards.
 */
const ARCADE_TOKEN_ADDR = '0x1ec721ce66eb56c1db87962e7e4fc8d0e3ef24b6' as const
/** Faze. Verified clean: zero fee, standard bool return, clears every market threshold. */
const FAZE = '0x394d38f807ee0027a182216f5e67a15ae441fa2e' as const
/** Arcflow. Same — verified with nothing failing. */
const AF = '0x75d658f8101fbe6dc217fbba7e20a0312af5fa2e' as const
const COOL = '0xeb64987643db71c76b2a2be7e723decc995e5b37' as const
const REGI = '0x93d5b8c53ee763c2c4522bf0d958ce51af4360ae' as const
const AKIT = '0xbc3764348131fe1962f267f442a8fe30459ededd' as const
const BUILDERS = '0xa37c1f9b2483b3b45ced74b10e19223aa76d18f2' as const
const ARCLIGHT = '0xa3de1dda14e4b3ce2eee2f8c1e49315effc15be2' as const
const TIDE = '0x92395d0cd51bb504a39e53105cb6862948af1b8e' as const
const POLL = '0xf76b1d00bd3d63a37246b5f512074e864010e33d' as const
const KAIRO = '0x3ead4e80e9e5bc0e01682d7ee74c4881b040d3ea' as const
const ARCBAT = '0xbe0cad585ea2d13de2f4e36376be755c0afd8b97' as const
const WAVE = '0xf1b72b46e2364356c1d8343590e4c0deefb19c3b' as const
/**
 * Matrixdock Gold. A claim on metal held by an issuer, and an upgradeable proxy — both
 * disclosed on /rewards. The band is tiny because one token is an ounce of gold.
 */
const XAUM = '0x178b01f61cbea1d2a5581fe1621be607835ec349' as const
/**
 * oBrain. Its v4 pool charges no static fee and sorts oBrain as currency0, which is why
 * `buy:token --venue dag` needed `--fee`. Admitted despite thin liquidity and volume.
 */
const OBRAIN = '0x28f986a61e078795639f239675582a12b4cf7f01' as const
/**
 * Arcanus. An EIP-1167 minimal proxy, which is the immutable kind — the implementation is
 * baked into the bytecode, not read from a slot. Admitted despite thin liquidity and volume.
 */
const ARCANUS = '0x29316db42ff99f640fd4d1bb169635b6318cd430' as const
/**
 * Argos Bot. Shown to players as ARGOSBOT: its real ticker is one letter from ARGUS, which
 * this same machine already pays at ultra and jackpot. See rewards.ts.
 */
const ARGOS = '0xe86688530c456e099732f953ed7aa7c583026680' as const
/**
 * UBI. Its pool is the first here with a tick spacing other than 200 — it uses 60 — which is
 * why `buy:token --venue dag` needed `--tick-spacing`. A day and a half old at admission.
 */
const UBI = '0xfa3ffdf775cc3f6ac82cd258fb948a8a21e1749e' as const
/**
 * Mosslings. Same 4,724-byte implementation and same v4 hook as oBrain, so the same
 * launchpad. The thinnest market in the table — see rewards.ts.
 */
const MOSS = '0xafa78bc7c2e1142f4b2a225ae4aee17d6b7d7f01' as const
/**
 * $SOLD. The only reward whose pool quotes against NATIVE USDC rather than the ERC-20, so it
 * buys through the Universal Router rather than the DEX router — and at tick spacing 1.
 */
const SOLD = '0x2a7a8c69a7462a2737a3b41188bc7a36d5555f2f' as const
const ARCAT = '0x07704b06981ea962b87296362a1281484d160000' as const
const LONG = '0x2164bb17a2d38c1b5170e987b2c0416df1efc752' as const
const CRCL = '0x2ba0f44bdfc17fba30eda9cdbecb908ca45b043b' as const
const CIRBTC = '0x171a4217b86a807a64eb94757db6849fb4bdbaa0' as const
const WETH = '0x128cc466b61f542da60c70e3aa11c10e19b84edb' as const
const EURC = '0xbef5f6d51cb62b58e6a8f77868681825c6fe21c1' as const
const VIRTUAL = '0x8c4252c87081c88c6ad57d6dd97e1cafebf842b7' as const

/**
 * Parses `NEXT_PUBLIC_ARCADE_MACHINE_IDS`, e.g. `genesis:1,velocity:2,blue-chip:3`.
 *
 * An unparseable entry is skipped rather than defaulted: a wrong machine id would point
 * players at the wrong reward table, which is far worse than a machine that reports itself
 * as not yet deployed.
 */
function parseMachineIds(raw: string | undefined): Map<string, number> {
  const ids = new Map<string, number>()
  if (!raw) return ids
  for (const entry of raw.split(',')) {
    const [slug, value] = entry.split(':')
    if (!slug || !value) continue
    const id = Number.parseInt(value.trim(), 10)
    if (!Number.isInteger(id) || id < 0) continue
    ids.set(slug.trim(), id)
  }
  return ids
}

const MACHINE_IDS = parseMachineIds(
  // Environment first, then the committed manifest for the resolved network — same
  // precedence as the contract addresses, so a build without env vars is still playable.
  process.env.NEXT_PUBLIC_ARCADE_MACHINE_IDS ??
    (FALLBACK_MODE ? KNOWN_DEPLOYMENTS[FALLBACK_MODE]?.machineIds : undefined),
)

const MACHINE_TEMPLATES: MachineConfig[] = [
  {
    // STALE: references cirBTC, which lost reward eligibility at block 22,258,137.
    // Velocity and Blue Chip carry the same stale reference. Rebuild any of these tables
    // before setting status back to 'live'; economics.test.ts records which ones are stale.
    slug: 'genesis',
    onchainId: null,
    name: 'Genesis',
    tagline: 'Arc Mainnet mix',
    description:
      'The broad one. Established Arc assets across four rarity bands, weighted toward frequent small wins.',
    spinPriceUsdc: '2',
    status: 'disabled',
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
    status: 'disabled',
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
    status: 'disabled',
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
    tagline: 'Three verified Arc assets',
    description:
      'Twenty-four Arc assets — COOL, $ARCADE, Faze, Arcflow, Beancat, TOLLY, ARGUS and tokenised gold among them — each transfer-probed against live Arc mainnet state. Four rarity bands, weighted toward frequent small wins.',
    spinPriceUsdc: '2',
    status: 'live',
    tiers: [
      {token: COOL, weight: 430, rarity: 'common', minAmount: '1042', maxAmount: '2194'},
      // Resized after ARCADE rose ~35%: the token band is fixed, so the VALUE it pays drifts
      // with price. At 40000–80000 it had reached $1.68–$3.35 against the ~$0.95–$2.00 every
      // other common pays, pulling the machine's payout ratio from 77.7% to 81.0%.
      {token: ARCADE_TOKEN_ADDR, weight: 430, rarity: 'common', minAmount: '32747', maxAmount: '68942'},
      {token: FAZE, weight: 362, rarity: 'common', minAmount: '278', maxAmount: '586'},
      {token: AF, weight: 362, rarity: 'common', minAmount: '797', maxAmount: '1678'},
      // Sized to the same ~$0.95–$2.00 band as every other common, at current prices.
      {token: REGI, weight: 340, rarity: 'common', minAmount: '30824', maxAmount: '64893'},
      {token: AKIT, weight: 339, rarity: 'common', minAmount: '7280', maxAmount: '15326'},
      {token: BUILDERS, weight: 346, rarity: 'common', minAmount: '42487', maxAmount: '89445'},
      {token: ARCLIGHT, weight: 386, rarity: 'common', minAmount: '1251', maxAmount: '2635'},
      {token: TIDE, weight: 376, rarity: 'common', minAmount: '3.1', maxAmount: '6.5'},
      {token: POLL, weight: 417, rarity: 'common', minAmount: '1775', maxAmount: '3736'},
      {token: KAIRO, weight: 462, rarity: 'common', minAmount: '1049', maxAmount: '2209'},
      {token: ARCBAT, weight: 440, rarity: 'common', minAmount: '17684', maxAmount: '37230'},
      {token: WAVE, weight: 421, rarity: 'common', minAmount: '6919', maxAmount: '14567'},
      {token: UDCAT, weight: 287, rarity: 'common', minAmount: '862', maxAmount: '1815'},
      {token: XAUM, weight: 399, rarity: 'common', minAmount: '0.000229', maxAmount: '0.000481'},
      {token: OBRAIN, weight: 385, rarity: 'common', minAmount: '6723', maxAmount: '14154'},
      {token: ARCANUS, weight: 409, rarity: 'common', minAmount: '4953', maxAmount: '10428'},
      {token: ARGOS, weight: 435, rarity: 'common', minAmount: '25600', maxAmount: '53894'},
      {token: UBI, weight: 462, rarity: 'common', minAmount: '165103', maxAmount: '347584'},
      {token: MOSS, weight: 491, rarity: 'common', minAmount: '22134', maxAmount: '46598'},
      {token: SOLD, weight: 521, rarity: 'common', minAmount: '2762', maxAmount: '5814'},
      {token: TOLLY, weight: 900, rarity: 'rare', minAmount: '160', maxAmount: '334'},
      {token: ARGUS, weight: 550, rarity: 'ultra', minAmount: '110', maxAmount: '220'},
      {token: ARGUS, weight: 50, rarity: 'jackpot', minAmount: '180', maxAmount: '300'},
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

/** Machines with their onchain ids resolved from the environment. */
export const MACHINES: MachineConfig[] = MACHINE_TEMPLATES.map((machine) => ({
  ...machine,
  onchainId: MACHINE_IDS.get(machine.slug) ?? machine.onchainId,
}))

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
