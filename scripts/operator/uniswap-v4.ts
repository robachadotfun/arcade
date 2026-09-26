import {encodeAbiParameters, encodeFunctionData, keccak256, type Address, type Hex} from 'viem'

/**
 * The Uniswap v4 calldata Arcade needs to buy its own token.
 *
 * ## Why this file exists at all
 *
 * ARCADE has no v3 pool. It trades in a single v4 pool, and v4 does not expose one function
 * per swap the way v3 did — every action goes through the Universal Router as an encoded
 * command stream. So buying ARCADE means building that stream by hand, which is what this
 * module does and all it does. Nothing here signs or sends.
 *
 * ## How the pool key was established
 *
 * A v4 pool has no address. It is identified by the hash of its key, so the key cannot be
 * read from a contract — it has to be recovered from the transaction that created the pool.
 *
 * An earlier attempt tried to guess it, searching 440 combinations of fee and tick spacing
 * against the shapes other Arc pools use, and found nothing. The reason was not the search
 * space: the PoolManager address being searched was wrong. The right one was found by
 * scanning for any log carrying the pool id and reading back which contract emitted it.
 *
 * With the correct PoolManager, the pool's `Initialize` event gives the key directly. The
 * values below are that event, decoded, and {@link assertPoolKey} re-derives the id from them
 * so a typo here fails immediately rather than sending USDC into the wrong pool.
 */

/** Uniswap v4 PoolManager on Arc, confirmed as the emitter of this pool's `Initialize`. */
export const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951' as const

/**
 * Universal Router on Arc.
 *
 * Confirmed by reading real ARCADE swaps: their transactions are sent here. Worth stating
 * because a router address is the one value in this file that a wrong guess turns into lost
 * funds — {@link assertPoolKey} cannot check it, so it was verified against live traffic
 * rather than taken from a note.
 */
export const UNIVERSAL_ROUTER = '0x4fca4a51ab4f23a7447b3284fbd7d73289a89fb1' as const

/** Canonical Permit2. The Universal Router pulls ERC-20s through it, never directly. */
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const

export type PoolKey = {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

/**
 * The ARCADE/USDC pool, decoded from its `Initialize` event.
 *
 * `currency1` is the USDC **ERC-20** at 0x3600…0000, which uses 6 decimals — not the native
 * gas asset, which uses 18. Amounts going into a swap are therefore 6-decimal values. Mixing
 * the two precisions is the single easiest way to spend a million times too much or too
 * little, so the caller states which it holds rather than inferring it.
 */
export const ARCADE_POOL_KEY: PoolKey = {
  currency0: '0x1ec721ce66Eb56c1dB87962e7e4fc8D0E3eF24B6',
  currency1: '0x3600000000000000000000000000000000000000',
  fee: 10_000,
  tickSpacing: 200,
  hooks: '0xceb3e407937c305b0a0d7db24f7a37775abae044',
}

const POOL_KEY_ABI = [
  {type: 'address'},
  {type: 'address'},
  {type: 'uint24'},
  {type: 'int24'},
  {type: 'address'},
] as const

/** A v4 pool id is the hash of its key. */
export function poolId(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(POOL_KEY_ABI, [
      key.currency0,
      key.currency1,
      key.fee,
      key.tickSpacing,
      key.hooks,
    ]),
  )
}

/**
 * Refuses to continue unless the key hashes to the pool actually being targeted.
 *
 * Cheap, local, and the only check that catches a mistyped fee or tick spacing before it
 * becomes a swap against a pool that does not exist — or worse, one that does.
 */
export function assertPoolKey(key: PoolKey, expectedId: Hex): void {
  const derived = poolId(key)
  if (derived.toLowerCase() !== expectedId.toLowerCase()) {
    throw new Error(
      `PoolKey does not match the expected pool.\n  derived:  ${derived}\n  expected: ${expectedId}`,
    )
  }
}

// Universal Router command: dispatch the encoded actions below to the v4 PoolManager.
const COMMAND_V4_SWAP = '0x10' as const

// v4 router actions.
const ACTION_SWAP_EXACT_IN_SINGLE = 0x06
const ACTION_SETTLE_ALL = 0x0c
const ACTION_TAKE_ALL = 0x0f

const EXACT_IN_SINGLE_ABI = [
  {
    type: 'tuple',
    components: [
      {
        name: 'poolKey',
        type: 'tuple',
        components: [
          {name: 'currency0', type: 'address'},
          {name: 'currency1', type: 'address'},
          {name: 'fee', type: 'uint24'},
          {name: 'tickSpacing', type: 'int24'},
          {name: 'hooks', type: 'address'},
        ],
      },
      {name: 'zeroForOne', type: 'bool'},
      {name: 'amountIn', type: 'uint128'},
      {name: 'amountOutMinimum', type: 'uint128'},
      {name: 'hookData', type: 'bytes'},
    ],
  },
] as const

const CURRENCY_AMOUNT_ABI = [{type: 'address'}, {type: 'uint256'}] as const

export const UNIVERSAL_ROUTER_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      {name: 'commands', type: 'bytes'},
      {name: 'inputs', type: 'bytes[]'},
      {name: 'deadline', type: 'uint256'},
    ],
    outputs: [],
  },
] as const

/** Minimal Permit2 surface: the Universal Router reads this allowance before pulling funds. */
export const PERMIT2_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'token', type: 'address'},
      {name: 'spender', type: 'address'},
      {name: 'amount', type: 'uint160'},
      {name: 'expiration', type: 'uint48'},
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      {name: 'owner', type: 'address'},
      {name: 'token', type: 'address'},
      {name: 'spender', type: 'address'},
    ],
    outputs: [
      {name: 'amount', type: 'uint160'},
      {name: 'expiration', type: 'uint48'},
      {name: 'nonce', type: 'uint48'},
    ],
  },
] as const

/**
 * Calldata for an exact-input swap through the Universal Router.
 *
 * Three actions, and all three are required. The swap itself only moves balances inside the
 * PoolManager's accounting; `SETTLE_ALL` is what actually pays the input, and `TAKE_ALL` is
 * what collects the output. Omitting either leaves the transaction unbalanced and v4 reverts,
 * which is the design: it cannot end holding an unresolved debt.
 *
 * @param amountIn         input amount, in the input currency's own decimals
 * @param amountOutMinimum slippage floor. A zero here is an instruction to accept any
 *                         price at all, so callers are expected to compute a real one.
 */
export function encodeExactInSingle({
  key,
  zeroForOne,
  amountIn,
  amountOutMinimum,
  deadline,
}: {
  key: PoolKey
  /** True when selling `currency0` for `currency1`; false for the other direction. */
  zeroForOne: boolean
  amountIn: bigint
  amountOutMinimum: bigint
  deadline: bigint
}): Hex {
  const currencyIn = zeroForOne ? key.currency0 : key.currency1
  const currencyOut = zeroForOne ? key.currency1 : key.currency0

  const actions = `0x${[ACTION_SWAP_EXACT_IN_SINGLE, ACTION_SETTLE_ALL, ACTION_TAKE_ALL]
    .map((a) => a.toString(16).padStart(2, '0'))
    .join('')}` as Hex

  const params: Hex[] = [
    encodeAbiParameters(EXACT_IN_SINGLE_ABI, [
      {poolKey: key, zeroForOne, amountIn, amountOutMinimum, hookData: '0x'},
    ]),
    encodeAbiParameters(CURRENCY_AMOUNT_ABI, [currencyIn, amountIn]),
    encodeAbiParameters(CURRENCY_AMOUNT_ABI, [currencyOut, amountOutMinimum]),
  ]

  const v4Input = encodeAbiParameters([{type: 'bytes'}, {type: 'bytes[]'}], [actions, params])

  return encodeFunctionData({
    abi: UNIVERSAL_ROUTER_ABI,
    functionName: 'execute',
    args: [COMMAND_V4_SWAP, [v4Input], deadline],
  })
}
