/* eslint-disable no-console */
/**
 * buy-tokens.ts — acquires reward inventory via Uniswap v4 (UniversalRouter) and v3 on Arc.
 *
 * Arc Mainnet uses Uniswap v4 pools for primary liquidity on many tokens (including FAZE and AF).
 * Native USDC (18 decimals) is passed as value to the UniversalRouter, which executes
 * the V4 swap against the canonical pool hook (0x47e7936ae9891e61c5123db720593c05de7120cc).
 */
import './operator/env'
import {
  parseUnits,
  formatUnits,
  encodeAbiParameters,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem'
import {loadContext} from './operator/context'

const UNIVERSAL_ROUTER: Address = '0x4fca4a51ab4f23a7447b3284fbd7d73289a89fb1'
const V4_POOL_HOOK: Address = '0x47e7936ae9891e61c5123db720593c05de7120cc'
const NATIVE_CURRENCY: Address = '0x0000000000000000000000000000000000000000'

const FAZE: Address = '0x394d38f807ee0027a182216f5e67a15ae441fa2e'
const AF: Address = '0x75d658f8101fbe6dc217fbba7e20a0312af5fa2e'

const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{name: 'account', type: 'address'}],
    outputs: [{name: '', type: 'uint256'}],
  },
] as const

const universalRouterAbi = [
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

interface V4Purchase {
  name: string
  address: Address
  amountInNativeUsdc: bigint // 18 decimals
  minAmountOut: bigint // 18 decimals
}

const PURCHASES: V4Purchase[] = [
  {
    name: 'FAZE',
    address: FAZE,
    amountInNativeUsdc: parseUnits('5', 18), // 5 native USDC
    minAmountOut: parseUnits('860', 18), // 860 FAZE required for vault funding
  },
  {
    name: 'AF',
    address: AF,
    amountInNativeUsdc: parseUnits('5', 18), // 5 native USDC
    minAmountOut: parseUnits('2000', 18), // 2000 AF required for vault funding
  },
]

async function main() {
  const ctx = await loadContext()
  const account = ctx.account!
  const walletClient = ctx.walletClient!
  const publicClient = ctx.publicClient!

  console.log(`\n======================================================`)
  console.log(`Acquiring Tokens on Arc Mainnet via Uniswap V4`)
  console.log(`UniversalRouter: ${UNIVERSAL_ROUTER}`)
  console.log(`Buyer wallet:    ${account}`)
  console.log(`======================================================\n`)

  const initialNativeBal = await publicClient.getBalance({address: account})
  console.log(`Current native USDC balance: ${formatUnits(initialNativeBal, 18)} USDC\n`)

  for (const item of PURCHASES) {
    const prevBal = await publicClient.readContract({
      address: item.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })
    console.log(`\n--- Buying ${item.name} ---`)
    console.log(`  Current balance: ${formatUnits(prevBal, 18)} ${item.name}`)
    console.log(`  Spending:        ${formatUnits(item.amountInNativeUsdc, 18)} native USDC`)
    console.log(`  Minimum output:  ${formatUnits(item.minAmountOut, 18)} ${item.name}`)

    // Action 0x06: SWAP_EXACT_IN_SINGLE
    const param0 = encodeAbiParameters(
      [
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
      ],
      [
        {
          poolKey: {
            currency0: NATIVE_CURRENCY,
            currency1: item.address,
            fee: 0,
            tickSpacing: 200,
            hooks: V4_POOL_HOOK,
          },
          zeroForOne: true,
          amountIn: item.amountInNativeUsdc,
          amountOutMinimum: item.minAmountOut,
          hookData: '0x' as Hex,
        },
      ],
    )

    // Action 0x0c: SETTLE_ALL (settle input currency from msg.value)
    const param1 = encodeAbiParameters(parseAbiParameters('address currency, uint256 maxAmount'), [
      NATIVE_CURRENCY,
      item.amountInNativeUsdc,
    ])

    // Action 0x0f: TAKE_ALL (take all output tokens to caller)
    const param2 = encodeAbiParameters(parseAbiParameters('address currency, uint256 minAmount'), [
      item.address,
      item.minAmountOut,
    ])

    // V4_SWAP input payload: (bytes actions, bytes[] params)
    const v4Input = encodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), [
      '0x060c0f' as Hex,
      [param0, param1, param2],
    ])

    const commands: Hex = '0x10' // V4_SWAP
    const inputs: Hex[] = [v4Input]
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)

    try {
      console.log(`  Submitting swap tx to UniversalRouter...`)
      const hash = await walletClient.writeContract({
        address: UNIVERSAL_ROUTER,
        abi: universalRouterAbi,
        functionName: 'execute',
        args: [commands, inputs, deadline],
        value: item.amountInNativeUsdc,
        chain: ctx.chain,
        account: walletClient.account!,
      })
      console.log(`  Tx hash: ${hash}`)
      console.log(`  Waiting for confirmation...`)
      const receipt = await publicClient.waitForTransactionReceipt({hash})
      console.log(`  ✓ Confirmed in block ${receipt.blockNumber}`)

      const newBal = await publicClient.readContract({
        address: item.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
      })
      const acquired = newBal - prevBal
      console.log(`  ✓ Received:     ${formatUnits(acquired, 18)} ${item.name}`)
      console.log(`  ✓ New balance:  ${formatUnits(newBal, 18)} ${item.name}`)
    } catch (err: unknown) {
      console.error(`  ✗ Error buying ${item.name}:`, err instanceof Error ? err.message : err)
      throw err
    }
  }

  const finalNativeBal = await publicClient.getBalance({address: account})
  console.log(`\n======================================================`)
  console.log(`All purchases completed successfully!`)
  console.log(`Remaining native USDC: ${formatUnits(finalNativeBal, 18)} USDC`)
  console.log(`======================================================\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
