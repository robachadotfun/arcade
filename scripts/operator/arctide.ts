import {encodeFunctionData, getAddress, parseAbi, type Address, type Hex} from 'viem'

/**
 * Buying tokens on Arctide, Arc's own AMM.
 *
 * TIDE trades nowhere else. Every Uniswap v3 fee tier and the UnitFlow V3 factory return no
 * pool for it, so the reward pipeline cannot stock it through the routes the other tokens
 * use. This module is that missing route.
 *
 * ## How the interface was established
 *
 * Not from documentation — there is none published for this router. The contract was found by
 * reading which address real TIDE transfers are sent to (38 of them in the scanned window),
 * its interface probed by selector against the deployed bytecode, and the call shape then
 * confirmed by decoding a successful mainnet swap in full.
 *
 * What that decode showed, and what guessing would have got wrong:
 *
 *   - it is a Uniswap **V2** fork: `getAmountsOut`, `getAmountsIn`, `factory()`, `WETH()`
 *   - `WETH()` returns the USDC ERC-20 at 0x3600…0000. On Arc the "ETH" side of a V2 router
 *     is USDC, so buying a token means `swapExactETHForTokens…` with USDC as `msg.value`
 *   - of the usual V2 swap entry points only the fee-supporting ETH variant is present. The
 *     plain token-to-token functions are absent, so encoding those reverts
 *   - **the router charges roughly 1.5% before the pool sees the trade.** In the decoded swap
 *     23 USDC went in and 22.655 reached the pair, the remainder going to two fee recipients.
 *     `getAmountsOut` quotes the *pool*, so a slippage floor computed straight from it is
 *     already about 1.5% too high before any price movement — see {@link quoteInputAfterFees}
 *
 * ## The decimals trap, again
 *
 * `msg.value` is native USDC at 18 decimals. `getAmountsOut` takes the 6-decimal ERC-20
 * amount. Same money, two precisions, and mixing them silently asks for a trade a million
 * times the intended size — the fork showed a 6-decimal value draining the whole reserve in a
 * quote. Callers pass a decimal string and this module scales both sides.
 */

/** Arctide V2 router, confirmed as the destination of real TIDE swaps. */
export const ARCTIDE_ROUTER: Address = getAddress('0xa161f98765b396d126d25c0ff7546f9fcea9b082')

/** Its factory, read from `router.factory()` rather than assumed. */
export const ARCTIDE_FACTORY: Address = getAddress('0x6AFd30Cb35D8B70Cfd84C9AcA92ddc2Dda2879Cb')

/** What `router.WETH()` returns on Arc: the 6-decimal USDC ERC-20, not an ether wrapper. */
export const ARCTIDE_WETH: Address = getAddress('0x3600000000000000000000000000000000000000')

export const USDC_DECIMALS = 6
export const NATIVE_DECIMALS = 18

/**
 * Router fee taken before the pool sees the input, in basis points.
 *
 * Measured from a real swap rather than read from a constant: 23 USDC in, 22.655 forwarded to
 * the pair, which is 150 bps across two recipients. Rounded up deliberately — this figure
 * shrinks the quote a caller compares against, so erring high loses a little precision in the
 * floor while erring low would make every slippage check too tight to fill.
 */
export const ROUTER_FEE_BPS = 150n

export const ROUTER_ABI = parseAbi([
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline) payable',
  'function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[] amounts)',
  'function factory() view returns (address)',
  'function WETH() view returns (address)',
])

export const FACTORY_ABI = parseAbi([
  'function getPair(address tokenA, address tokenB) view returns (address pair)',
])

export const PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
])

/**
 * The amount that actually reaches the pool, for quoting.
 *
 * `getAmountsOut` prices a trade against the pair's reserves and knows nothing about the
 * router's own cut. Quoting the full input therefore overstates the output by the fee, and a
 * slippage floor derived from it can never be met — the swap reverts looking like a price
 * problem when it is an arithmetic one.
 */
export function quoteInputAfterFees(amountIn: bigint): bigint {
  return (amountIn * (10_000n - ROUTER_FEE_BPS)) / 10_000n
}

/**
 * Refuses to build a swap unless the pair exists and holds reserves.
 *
 * A V2 factory returns the zero address for a pair that was never created, and a created-but-
 * empty pair quotes zero rather than failing. Both end in a revert with nothing useful said,
 * so both are caught here while it is still free.
 */
export async function requirePair(
  readContract: (args: never) => Promise<unknown>,
  token: Address,
): Promise<Address> {
  const pair = (await readContract({
    address: ARCTIDE_FACTORY,
    abi: FACTORY_ABI,
    functionName: 'getPair',
    args: [ARCTIDE_WETH, token],
  } as never)) as Address

  if (!pair || BigInt(pair) === 0n) {
    throw new Error(
      `No Arctide pair for ${token} against USDC. Nothing was sent.\n` +
        'This router only trades pairs its own factory created.',
    )
  }
  return pair
}

/**
 * Calldata for buying `path[path.length - 1]` with native USDC.
 *
 * The value to send alongside is the same amount expressed at 18 decimals; this module does
 * not send anything, so the caller pairs the two.
 *
 * @param amountOutMin slippage floor in the output token's own decimals. Zero is rejected:
 *                     against a pool this size it authorises any price at all.
 */
export function encodeArctideBuy({
  token,
  amountOutMin,
  recipient,
  deadline,
}: {
  token: Address
  amountOutMin: bigint
  recipient: Address
  deadline: bigint
}): Hex {
  if (amountOutMin <= 0n) {
    throw new Error('amountOutMin must be greater than zero — refusing to swap at any price.')
  }
  return encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
    args: [amountOutMin, [ARCTIDE_WETH, token], recipient, deadline],
  })
}
