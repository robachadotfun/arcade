/**
 * The $ARCADE token.
 *
 * Separate from `rewards.ts` on purpose: this is the project's own token, not a reward asset.
 * It is deliberately **not** in any machine's reward table — at the time of writing it clears
 * every contract-level check (transfer probed against live mainnet state, zero fee, standard
 * bool return) but fails the market thresholds the reward registry publishes, by a wide
 * margin. A reward has to be sellable by whoever wins it.
 */

/** ARCADE, deployed on Arc Mainnet. 18 decimals, fixed supply, verified transfer behaviour. */
export const ARCADE_TOKEN = {
  address: '0x1ec721ce66Eb56c1dB87962e7e4fc8D0E3eF24B6',
  symbol: 'ARCADE',
  name: 'Arcade',
  decimals: 18,
  /** Minted once at deploy. Nothing can mint more. */
  totalSupply: 1_000_000_000,
} as const

/**
 * Where bought-back tokens go.
 *
 * ARCADE has no `burn()` — it is a minimal proxy from a launchpad and the call reverts — so
 * "burned" here means sent to an address whose private key cannot exist. The supply figure
 * the contract reports does not go down; the circulating amount does. The UI says exactly
 * that rather than claiming a supply reduction that did not happen.
 */
export const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const

/** The pool ARCADE actually trades in. Uniswap v4 — it has no v3 pool against USDC. */
export const ARCADE_POOL_ID =
  '0xf1065f2f040e9df9111da888e85fdb314915ace49994c677102298bb31c696e7' as const
