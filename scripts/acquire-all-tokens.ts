/* eslint-disable no-console */
/**
 * acquire-all-tokens.ts
 *
 * Acquires inventory for all 6 required arcade vault tokens:
 * - FAZE & AF via Uniswap v4 UniversalRouter (native USDC)
 * - ARGUS via Uniswap v3 SwapRouter02 (exact output with ERC20 USDC)
 * - REGI, AKIT & ARCADE via Arc DEX Router dagSwapTo (ERC20 USDC)
 */
import './operator/env'
import {
  keccak256,
  parseUnits,
  formatUnits,
  encodeAbiParameters,
  parseAbiParameters,
  encodeFunctionData,
  parseAbi,
  getAddress,
  type Address,
  type Hex,
} from 'viem'
import {loadContext} from './operator/context'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const ctx = await loadContext()
  const account = getAddress(ctx.account!)
  const walletClient = ctx.walletClient!
  const publicClient = ctx.publicClient!

  console.log('\n======================================================')
  console.log('Acquiring Required Inventory on Arc Mainnet')
  console.log(`Operator Account: ${account}`)
  console.log('======================================================\n')

  const initialNative = await publicClient.getBalance({address: account})
  console.log(`Starting native USDC balance: ${formatUnits(initialNative, 18)} USDC\n`)

  const erc20Abi = parseAbi([
    'function balanceOf(address account) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
  ])

  // ───────────────────────────────────────────────────────────── 1. FAZE (v4 UniversalRouter)
  const V4_ROUTER: Address = getAddress('0x4fca4a51ab4f23a7447b3284fbd7d73289a89fb1')
  const V4_HOOK: Address = getAddress('0x47e7936ae9891e61c5123db720593c05de7120cc')
  const NATIVE_CURRENCY: Address = getAddress('0x0000000000000000000000000000000000000000')
  const FAZE: Address = getAddress('0x394d38f807ee0027a182216f5e67a15ae441fa2e')
  const AF: Address = getAddress('0x75d658f8101fbe6dc217fbba7e20a0312af5fa2e')

  async function buyV4Native(name: string, token: Address, usdcIn: string, minOutTokens: string) {
    const val = parseUnits(usdcIn, 18)
    const minOut = parseUnits(minOutTokens, 18)
    const prevBal = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })

    console.log(`\n--- Buying ${name} via Uniswap v4 (spending ${usdcIn} native USDC) ---`)
    const p0 = encodeAbiParameters(
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
            currency1: token,
            fee: 0,
            tickSpacing: 200,
            hooks: V4_HOOK,
          },
          zeroForOne: true,
          amountIn: val,
          amountOutMinimum: minOut,
          hookData: '0x' as Hex,
        },
      ],
    )
    const p1 = encodeAbiParameters(parseAbiParameters('address currency, uint256 maxAmount'), [
      NATIVE_CURRENCY,
      val,
    ])
    const p2 = encodeAbiParameters(parseAbiParameters('address currency, uint256 minAmount'), [
      token,
      minOut,
    ])
    const v4Input = encodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), [
      '0x060c0f' as Hex,
      [p0, p1, p2],
    ])

    const uAbi = parseAbi([
      'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
    ])
    const hash = await walletClient.writeContract({
      address: V4_ROUTER,
      abi: uAbi,
      functionName: 'execute',
      args: ['0x10' as Hex, [v4Input], BigInt(Math.floor(Date.now() / 1000) + 1200)],
      value: val,
      chain: ctx.chain,
      account: walletClient.account!,
    })
    console.log(`  Tx: ${hash}`)
    await publicClient.waitForTransactionReceipt({hash})
    const newBal = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })
    console.log(`  ✓ Received: ${formatUnits(newBal - prevBal, 18)} ${name} (Total: ${formatUnits(newBal, 18)})`)
  }

  await buyV4Native('FAZE', FAZE, '6', '886')
  await sleep(2500)
  await buyV4Native('AF', AF, '3', '674')
  await sleep(2500)

  // ───────────────────────────────────────────────────────────── 2. ARGUS (v3 SwapRouter02)
  const V3_ROUTER: Address = getAddress('0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77')
  const ERC20_USDC: Address = getAddress('0x3600000000000000000000000000000000000000')
  const ARGUS: Address = getAddress('0xece5ca8bf9220718e5727754026757512212cb3c')

  console.log('\n--- Buying ARGUS via Uniswap v3 (exact output 300 ARGUS) ---')
  const prevArgus = await publicClient.readContract({
    address: ARGUS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account],
  })

  const v3Abi = parseAbi([
    'function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountIn)',
  ])

  const argusHash = await walletClient.writeContract({
    address: V3_ROUTER,
    abi: v3Abi,
    functionName: 'exactOutputSingle',
    args: [
      {
        tokenIn: ERC20_USDC,
        tokenOut: ARGUS,
        fee: 10000,
        recipient: account,
        amountOut: parseUnits('300', 18),
        amountInMaximum: parseUnits('12', 6), // max 12 USDC
        sqrtPriceLimitX96: 0n,
      },
    ],
    chain: ctx.chain,
    account: walletClient.account!,
  })
  console.log(`  Tx: ${argusHash}`)
  await publicClient.waitForTransactionReceipt({hash: argusHash})
  const newArgus = await publicClient.readContract({
    address: ARGUS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account],
  })
  console.log(`  ✓ Received: ${formatUnits(newArgus - prevArgus, 18)} ARGUS (Total: ${formatUnits(newArgus, 18)})`)
  await sleep(2500)

  // ───────────────────────────────────────────────────────────── 3. REGI, AKIT, ARCADE (Arc DEX Router)
  const DEX_ROUTER: Address = getAddress('0x4E3bcCE28cAf98A143Fd8BD9e4875ccAb3E7bBE0')
  const SWAPPER: Address = getAddress('0x42170295F1173c9e5874ea9D00c6D137E1a4F53D')

  const DAG_SWAP_ABI = parseAbi([
    'function dagSwapTo(uint256 amountIn, address receiver, (uint256,address,uint256,uint256,uint256) desc, (address[] target, address[] tokens, uint256[] amounts, bytes[] data, uint256 flags)[] routes) payable returns (uint256)',
  ])

  /**
   * Pool ids for the hooked pools bought through the DEX router.
   *
   * A v4 pool is identified by the hash of its key, so a wrong hook address does not fail —
   * it silently addresses a different pool, or one that does not exist. The hooks below were
   * recovered from each pool's creation, and {@link assertPool} re-derives the id from them
   * before any USDC moves. Without that check the only thing standing between a mistyped
   * character and a swap into the wrong pool is proofreading.
   */
  const EXPECTED_POOL_ID: Record<string, Hex> = {
    REGI: '0x0530f18eb32d732cc8b067bbd0b2ba7e5d807d4f5cf4f7d74429f2a78d3120c8',
    AKIT: '0x67b53af67c3f1886d0618b16f86684dfd75d486064782a3eddca83541400fdce',
    ARCADE: '0xf1065f2f040e9df9111da888e85fdb314915ace49994c677102298bb31c696e7',
  }

  function assertPool(name: string, tokenOut: Address, hook: Address, fee: number, tickSpacing: number) {
    const expected = EXPECTED_POOL_ID[name]
    if (!expected) throw new Error(`No expected pool id recorded for ${name}. Refusing to swap blind.`)

    // v4 orders a pool's currencies by address, not by which side is being paid.
    const [currency0, currency1] =
      BigInt(ERC20_USDC) < BigInt(tokenOut) ? [ERC20_USDC, tokenOut] : [tokenOut, ERC20_USDC]

    const derived = keccak256(
      encodeAbiParameters(
        [{type: 'address'}, {type: 'address'}, {type: 'uint24'}, {type: 'int24'}, {type: 'address'}],
        [currency0, currency1, fee, tickSpacing, hook],
      ),
    )
    if (derived.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `${name}: pool key does not match the expected pool.\n  derived:  ${derived}\n  expected: ${expected}\n` +
          'Nothing was spent. Check the hook, fee and tick spacing.',
      )
    }
    console.log(`  pool key verified for ${name}`)
  }

  async function buyDexRouter(name: string, tokenOut: Address, hook: Address, usdcInNumber: number, minTokensOut: number) {
    assertPool(name, tokenOut, hook, 10000, 200)
    const amountIn = parseUnits(usdcInNumber.toString(), 6)
    const minReturn = parseUnits(minTokensOut.toString(), 18)
    const prevBal = await publicClient.readContract({
      address: tokenOut,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })

    console.log(`\n--- Buying ${name} via Arc DEX Router (spending ${usdcInNumber} USDC) ---`)
    const poolKeyData = encodeAbiParameters(
      [
        {
          type: 'tuple[]',
          components: [
            {name: 'currency0', type: 'address'},
            {name: 'currency1', type: 'address'},
            {name: 'fee', type: 'uint24'},
            {name: 'tickSpacing', type: 'int24'},
            {name: 'hooks', type: 'address'},
            {name: 'hookData', type: 'bytes'},
          ],
        },
      ],
      [
        [
          {
            currency0: ERC20_USDC,
            currency1: tokenOut,
            fee: 10000,
            tickSpacing: 200,
            hooks: hook,
            hookData: '0x',
          },
        ],
      ],
    )

    const routes = [
      {
        target: [SWAPPER],
        tokens: [SWAPPER],
        amounts: [BigInt('57896044618658097711785602900331631353717821766357806076882964734477131055104')],
        data: [poolKeyData],
        flags: BigInt(ERC20_USDC),
      },
    ]

    const desc: [bigint, Address, bigint, bigint, bigint] = [
      BigInt(ERC20_USDC),
      tokenOut,
      amountIn,
      minReturn,
      BigInt(Math.floor(Date.now() / 1000) + 1200),
    ]

    const hash = await walletClient.writeContract({
      address: DEX_ROUTER,
      abi: DAG_SWAP_ABI,
      functionName: 'dagSwapTo',
      args: [0n, account, desc, routes],
      value: 0n,
      chain: ctx.chain,
      account: walletClient.account!,
    })
    console.log(`  Tx: ${hash}`)
    await publicClient.waitForTransactionReceipt({hash})
    const newBal = await publicClient.readContract({
      address: tokenOut,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })
    console.log(`  ✓ Received: ${formatUnits(newBal - prevBal, 18)} ${name} (Total: ${formatUnits(newBal, 18)})`)
  }

  // REGI: need 37,500 -> spend 6 USDC (~43,000)
  const REGI: Address = getAddress('0x93D5b8c53ee763C2c4522bF0d958ce51Af4360ae')
  const REGI_HOOK: Address = getAddress('0x779a7f22480db20ed3ed2bb7950b207ce71ae044')
  await buyDexRouter('REGI', REGI, REGI_HOOK, 6, 37500)
  await sleep(2500)

  // AKIT: need 31,500 -> spend 6 USDC (~33,800)
  const AKIT: Address = getAddress('0xBc3764348131Fe1962f267f442a8Fe30459ededD')
  const AKIT_HOOK: Address = getAddress('0xa0f72de996d901c2c9d701a2a8ff0544fd5f2044')
  await buyDexRouter('AKIT', AKIT, AKIT_HOOK, 6, 31500)
  await sleep(2500)

  // ARCADE: need 40,000 -> spend 1.2 USDC (~46,000)
  const ARCADE: Address = getAddress('0x1ec721ce66Eb56c1dB87962e7e4fc8D0E3eF24B6')
  const ARCADE_HOOK: Address = getAddress('0xceb3e407937c305b0a0d7db24f7a37775abae044')
  await buyDexRouter('ARCADE', ARCADE, ARCADE_HOOK, 1.2, 40000)

  console.log('\n======================================================')
  console.log('All 6 Token Purchases Completed!')
  const finalNative = await publicClient.getBalance({address: account})
  console.log(`Remaining native USDC: ${formatUnits(finalNative, 18)} USDC`)
  console.log('======================================================\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
