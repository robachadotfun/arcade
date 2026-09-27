import {getAddress, type Address, type Hex} from 'viem'

/**
 * Buying $ARCADE through AchSwap's aggregator.
 *
 * ARCADE trades in a Uniswap v4 pool whose hook returns a delta on `beforeSwap`. The Universal
 * Router cannot execute that — it reverts at ~35k gas with empty revert data — which is why
 * the buyback has been routing through a DEX router instead. AchSwap's aggregator does handle
 * it: its calldata carries the full v4 PoolKey including the hook, and it reaches the same
 * PoolManager directly.
 *
 * ## How this was established
 *
 * From a real successful swap, decoded. AchSwap publishes no ABI for this selector, so the
 * call shape was recovered rather than looked up, and every claim below is something a
 * transaction demonstrated rather than something documentation asserted.
 *
 * The one thing worth recording is the mistake, because it cost the most time. The call goes
 * to the **Arc Native USDC Adapter**, not the `AchExecutionRouter` that the docs list first and
 * that the transaction's own logs feature prominently. Sending the same calldata to the router
 * reverts. An earlier attempt read those logs, targeted the router, watched even a verbatim
 * replay fail, and concluded the route must be quote-bound and unusable — a conclusion built
 * entirely on the wrong destination. `tx.to` said otherwise the whole time.
 *
 * ## Why this is a template and not an encoder
 *
 * The route is a 544-byte blob describing the path across adapters. Nothing published explains
 * its layout, and guessing at a structure that moves treasury funds is not worth the few bytes
 * of elegance. So the blob is carried verbatim from a known-good transaction and only the
 * fields whose meaning is *demonstrated* are substituted:
 *
 *   word 1   amountOutMinimum
 *   word 2   recipient
 *   word 7   deadline
 *   word 23  amountIn, in 6-decimal USDC, inside the route blob
 *   value    the same amountIn in 18-decimal native USDC
 *
 * Verified by substitution against live mainnet at 0.2367, 0.5, 1 and 1.5 USDC: output scales
 * linearly and nothing reverts. {@link quoteViaSimulation} re-checks that on every run, so a
 * blob that stops working fails loudly instead of quietly routing somewhere unintended.
 */

/** The contract the working transaction actually calls. Not the ExecutionRouter. */
export const ACHSWAP_NATIVE_USDC_ADAPTER: Address = getAddress(
  '0x097d6546db9fba2F908A88eE30FC870eb55fde90',
)

/** Selector of the aggregator swap. No published name; the four bytes are what matters. */
const SWAP_SELECTOR = '0x4eb223a6'

/**
 * A known-good ARCADE route, taken verbatim from
 * 0xeba5bf7cbce5b05eff73ea9541911738a702520838dbcbacde4e2c77f119a4a7.
 *
 * Only the words named above are ever overwritten. Everything else — adapter indices, the
 * embedded v4 PoolKey, the hook, the sqrt price limit — is left exactly as the working
 * transaction had it.
 */
const ARCADE_ROUTE_TEMPLATE: readonly string[] = [
  '0000000000000000000000001ec721ce66eb56c1db87962e7e4fc8d0e3ef24b6',
  '0000000000000000000000000000000000000000000000e0ec12378d4b062571',
  '0000000000000000000000005820cdcee868f395eb26fa9b00123f4b7530dc11',
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000100',
  '0000000000000000000000000000000000000000000000000000000000000b8d',
  '0000000000000000000000000000000000000000000000000000000000000019',
  '000000000000000000000000000000000000000000000000000000006ab92a9f',
  '0000000000000000000000000000000000000000000000000000000000000220',
  '0000000000000000000000000000000000000000000000000000000000000020',
  '0000000000000000000000000000000000000000000000000000000000000001',
  '0000000000000000000000000000000000000000000000000000000000000020',
  '0000000000000000000000000000000000000000000000000000000000000002',
  '0000000000000000000000000000000000000000000000000000000000002710',
  '0000000000000000000000000000000000000000000000000000000000000060',
  '0000000000000000000000000000000000000000000000000000000000000140',
  '0000000000000000000000001ec721ce66eb56c1db87962e7e4fc8d0e3ef24b6',
  '0000000000000000000000003600000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000002710',
  '00000000000000000000000000000000000000000000000000000000000000c8',
  '000000000000000000000000ceb3e407937c305b0a0d7db24f7a37775abae044',
  '0000000000000000000000000000000000000000000000000000000000000000',
  '000000000000000000000000fffd8963efd1fc6a506488495d951d5263988d25',
  '0000000000000000000000000000000000000000000000000000000000039c9c',
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000000',
] as const

/** Word indices whose meaning is demonstrated, and which this module is willing to change. */
const WORD = {amountOutMin: 1, recipient: 2, deadline: 7, amountIn6: 23} as const

function toWord(value: bigint | string): string {
  const hex = typeof value === 'bigint' ? value.toString(16) : value.replace(/^0x/, '')
  if (hex.length > 64) throw new Error(`Value does not fit in a word: ${hex}`)
  return hex.padStart(64, '0')
}

export function encodeAchswapBuy({
  amountIn6,
  amountOutMinimum,
  recipient,
  deadline,
}: {
  /** Input in 6-decimal USDC — the scale the route blob carries. */
  amountIn6: bigint
  amountOutMinimum: bigint
  recipient: Address
  deadline: bigint
}): Hex {
  const words = [...ARCADE_ROUTE_TEMPLATE]
  words[WORD.amountOutMin] = toWord(amountOutMinimum)
  words[WORD.recipient] = toWord(recipient.toLowerCase())
  words[WORD.deadline] = toWord(deadline)
  words[WORD.amountIn6] = toWord(amountIn6)
  return `${SWAP_SELECTOR}${words.join('')}` as Hex
}

/**
 * Prices the swap by simulating it with a floor of 1 and reading what comes back.
 *
 * There is no usable quoter here: `AchQuoteEngine.quote` exists but returns a shape this
 * module could not decode sensibly — 1 USDC priced at 223 million ARCADE, and barely moving
 * with input — so trusting it would be worse than not quoting at all.
 *
 * Simulating the real call against live state is both a quote and a proof that this exact
 * calldata executes. A price snapshot cannot do the second, and the second is what stops a
 * stale number from setting an unmeetable floor — which is exactly how the previous buyback
 * reverted.
 */
export async function quoteViaSimulation(
  call: (args: {account: Address; to: Address; data: Hex; value: bigint}) => Promise<{data?: Hex}>,
  {amountIn6, amountIn18, account}: {amountIn6: bigint; amountIn18: bigint; account: Address},
): Promise<bigint> {
  const probe = encodeAchswapBuy({
    amountIn6,
    amountOutMinimum: 1n,
    recipient: account,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
  })
  const result = await call({
    account,
    to: ACHSWAP_NATIVE_USDC_ADAPTER,
    data: probe,
    value: amountIn18,
  })
  const returned = result.data
  if (!returned || returned === '0x') {
    throw new Error('AchSwap simulation returned no data; refusing to price the swap from it.')
  }
  return BigInt(returned.slice(0, 66))
}
