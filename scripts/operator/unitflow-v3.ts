import {encodeFunctionData, getAddress, parseAbi, type Address, type Hex} from 'viem'

/**
 * Swapping through UnitFlow's V3 AMM on Arc.
 *
 * A separate module from `uniswap-v4.ts` on purpose: despite the naming similarity this is a
 * *V3* interface — concentrated-liquidity pools with their own addresses, reached through a
 * plain router call rather than v4's encoded command stream. Putting it in the v4 file would
 * make the two look interchangeable, and they are not.
 *
 * ## Why this exists alongside the v4 route
 *
 * ARCADE's only pool today is Uniswap v4, behind a hook that returns a delta on `beforeSwap`.
 * That works, but it is one venue. Routing a buyback through UnitFlow instead requires an
 * ARCADE/USDC pool on their factory, which at the time of writing does not exist — see
 * {@link UNITFLOW_V3} and the note on pool creation below.
 *
 * So this module is written ahead of the pool, not after it. Everything here is verified
 * against live mainnet state; the one thing it cannot do is invent liquidity.
 *
 * ## What was verified, and how
 *
 * The addresses come from UnitFlow's own developer docs and were then checked on chain rather
 * than trusted:
 *
 *   - all four contracts hold real bytecode on Arc (chain 5042)
 *   - `router.factory()` returns exactly the documented factory, so the router trades the
 *     pools this module queries — a mismatch there would mean quoting one venue and swapping
 *     on another
 *   - the router's bytecode contains `exactInputSingle` **with** a deadline (selector
 *     0x414bf389), and none of the SwapRouter02 selectors. It is the original V3 `SwapRouter`
 *     ABI, so the struct below carries `deadline`. Encoding the 02 shape would revert.
 *   - all four fee tiers are enabled on the factory (100/500/3000/10000 with tick spacings
 *     1/10/60/200)
 *   - `createPool` simulates successfully from an ordinary wallet, so pools are permissionless
 *     — creating the ARCADE/USDC pool does not need UnitFlow's team
 */

/** UnitFlow V3 on Arc Mainnet. Documented addresses, each confirmed to hold code. */
export const UNITFLOW_V3 = {
  router: getAddress('0x6fD8351b9596C1F0b2f2479BfA6A171cb3d0f410'),
  factory: getAddress('0x5bfBCeb73d39F722B1cB83fD2F11736b28c1Be6d'),
  quoter: getAddress('0x5AF6E89F0960Ff375AF84d9911D8153ef6240E34'),
  positionManager: getAddress('0x300F5f2861eF0d9D3c6B812797C0A4c8b15C86a8'),
} as const

/**
 * Fee tier to use for ARCADE/USDC.
 *
 * 10000 (1%) with tick spacing 200, matching the existing Uniswap v4 pool. Same asset, same
 * fee: a cheaper tier here would simply drain the v4 pool's flow into a shallower book rather
 * than add depth anywhere.
 */
export const ARCADE_FEE_TIER = 10_000 as const

export const FACTORY_ABI = parseAbi([
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
  'function createPool(address tokenA, address tokenB, uint24 fee) returns (address pool)',
  'function feeAmountTickSpacing(uint24 fee) view returns (int24)',
])

export const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)',
])

/**
 * The original V3 `SwapRouter`, which takes a deadline inside the struct.
 *
 * Confirmed by selector against the deployed bytecode rather than assumed from the name.
 */
export const ROUTER_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {name: 'tokenIn', type: 'address'},
          {name: 'tokenOut', type: 'address'},
          {name: 'fee', type: 'uint24'},
          {name: 'recipient', type: 'address'},
          {name: 'deadline', type: 'uint256'},
          {name: 'amountIn', type: 'uint256'},
          {name: 'amountOutMinimum', type: 'uint256'},
          {name: 'sqrtPriceLimitX96', type: 'uint160'},
        ],
      },
    ],
    outputs: [{name: 'amountOut', type: 'uint256'}],
  },
] as const

/**
 * Refuses to build a swap unless the pool it would trade actually exists.
 *
 * The V3 equivalent of the pool-key check the v4 routes carry. A V3 pool has a real address,
 * so this is a lookup rather than a hash — but the failure it prevents is the same one: a
 * swap aimed at a venue that is not there. `getPool` returning the zero address means no
 * pool, and the router would revert without saying why.
 *
 * @returns the pool address, so the caller can report which venue it is about to trade.
 */
export async function requirePool(
  read: (args: {address: Address; abi: typeof FACTORY_ABI; functionName: 'getPool'; args: [Address, Address, number]}) => Promise<unknown>,
  tokenA: Address,
  tokenB: Address,
  fee: number = ARCADE_FEE_TIER,
): Promise<Address> {
  const pool = (await read({
    address: UNITFLOW_V3.factory,
    abi: FACTORY_ABI,
    functionName: 'getPool',
    args: [tokenA, tokenB, fee],
  })) as Address

  // The factory returns the zero address for a pool that was never created.
  if (!pool || BigInt(pool) === 0n) {
    throw new Error(
      `No UnitFlow V3 pool for ${tokenA} / ${tokenB} at fee ${fee}.\n` +
        'Nothing was sent. The pool has to be created and seeded before a swap can route here.\n' +
        'createPool on the factory is permissionless, but an empty pool still cannot fill a trade.',
    )
  }
  return pool
}

/**
 * Calldata for an exact-input swap on UnitFlow V3.
 *
 * @param amountOutMinimum slippage floor, in the output token's decimals. A zero accepts any
 *                         price at all, which in a new pool is not a trade but a donation, so
 *                         callers compute a real one.
 * @param sqrtPriceLimitX96 left at 0 (no limit) because `amountOutMinimum` already bounds the
 *                          outcome; setting both invites one to mask the other.
 */
export function encodeUnitFlowExactInSingle({
  tokenIn,
  tokenOut,
  fee = ARCADE_FEE_TIER,
  recipient,
  amountIn,
  amountOutMinimum,
  deadline,
}: {
  tokenIn: Address
  tokenOut: Address
  fee?: number
  recipient: Address
  amountIn: bigint
  amountOutMinimum: bigint
  deadline: bigint
}): Hex {
  if (amountOutMinimum <= 0n) {
    throw new Error('amountOutMinimum must be greater than zero — refusing to swap at any price.')
  }
  return encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: 'exactInputSingle',
    args: [
      {
        tokenIn,
        tokenOut,
        fee,
        recipient,
        deadline,
        amountIn,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  })
}
