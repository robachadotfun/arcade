/**
 * The $ARCADE token.
 *
 * Separate from `rewards.ts` on purpose: this is the project's own token, not a reward asset.
 * It is deliberately **not** in any machine's reward table — at the time of writing it clears
 * every contract-level check (transfer probed against live mainnet state, zero fee, standard
 * bool return) but fails the market thresholds the reward registry publishes, by a wide
 * margin. A reward has to be sellable by whoever wins it.
 */

/**
 * ARCADE, deployed on Arc Mainnet. 18 decimals, fixed supply.
 *
 * Replaced the launchpad proxy at PREVIOUS_ARCADE_TOKEN on 2026-10-01. Read from mainnet that
 * day: name "Arcade", symbol ARCADE, 18 decimals, 1,000,000,000 supply, and no burn, mint,
 * owner or upgrade function in its bytecode.
 */
export const ARCADE_TOKEN = {
  address: '0xB1bB1616E72eb59dEBd5ff1b8A6A295a726D1dE5',
  symbol: 'ARCADE',
  name: 'Arcade',
  decimals: 18,
  /** Minted once at deploy. Nothing can mint more. */
  totalSupply: 1_000_000_000,
} as const

/**
 * The ARCADE token before the 2026-10-01 switch.
 *
 * Still live, and still what the Discovery machine pays its ARCADE prize in: that table is
 * onchain, so it keeps this address in machines.ts until an operator updates the machine.
 * ARCADE_POOL_ID and ARCADE_POOL_KEY also still describe this token's pool.
 */
export const PREVIOUS_ARCADE_TOKEN = '0x1ec721ce66Eb56c1dB87962e7e4fc8D0E3eF24B6' as const

/**
 * Where bought-back tokens go.
 *
 * ARCADE has no `burn()` — neither the current contract nor the launchpad proxy before it — so
 * "burned" here means sent to an address whose private key cannot exist. The supply figure
 * the contract reports does not go down; the circulating amount does. The UI says exactly
 * that rather than claiming a supply reduction that did not happen.
 */
export const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const

/**
 * PREVIOUS_ARCADE_TOKEN's Uniswap v4 pool — it has no v3 pool against USDC. The current
 * token's pool is not recorded yet, so /token hides this and the buyback refuses to run.
 */
export const ARCADE_POOL_ID =
  '0xf1065f2f040e9df9111da888e85fdb314915ace49994c677102298bb31c696e7' as const
