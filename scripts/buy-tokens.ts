import './operator/env'
import {parseUnits, formatUnits, maxUint256, type Address} from 'viem'
import {loadContext} from './operator/context'

const SWAP_ROUTER: Address = '0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77'
const USDC_ERC20: Address = '0x3600000000000000000000000000000000000000'

const erc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      {name: 'spender', type: 'address'},
      {name: 'amount', type: 'uint256'},
    ],
    outputs: [{name: '', type: 'bool'}],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      {name: 'owner', type: 'address'},
      {name: 'spender', type: 'address'},
    ],
    outputs: [{name: '', type: 'uint256'}],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{name: 'account', type: 'address'}],
    outputs: [{name: '', type: 'uint256'}],
  },
] as const

const swapRouterAbi = [
  {
    type: 'function',
    name: 'exactOutputSingle',
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
          {name: 'amountOut', type: 'uint256'},
          {name: 'amountInMaximum', type: 'uint256'},
          {name: 'sqrtPriceLimitX96', type: 'uint160'},
        ],
      },
    ],
    outputs: [{name: 'amountIn', type: 'uint256'}],
  },
] as const

const PURCHASES = [
  {
    name: 'ARGUS',
    address: '0xeCe5cA8bf9220718E5727754026757512212cb3c' as Address,
    amountOut: parseUnits('600', 18),
    amountInMax: parseUnits('15', 6), // 15 USDC max
    fee: 10000,
  },
  {
    name: 'COOL',
    address: '0xEb64987643db71c76b2a2BE7E723DECC995E5b37' as Address,
    amountOut: parseUnits('5400', 18),
    amountInMax: parseUnits('15', 6),
    fee: 10000,
  },
  {
    name: 'TOLLY',
    address: '0xBc43CE8DEc648EA298C4275559b81D6261c90b67' as Address,
    amountOut: parseUnits('1600', 18),
    amountInMax: parseUnits('15', 6),
    fee: 10000,
  },
  {
    name: 'UDCAT',
    address: '0x8E98A62a995A50eca9979bfa016f91bf36A8F9D9' as Address,
    amountOut: parseUnits('5200', 18),
    amountInMax: parseUnits('15', 6),
    fee: 10000,
  },
  {
    name: 'BCAT',
    address: '0x258bbb25fB1bc34C87212F8dAB34838854eF2D5D' as Address,
    amountOut: parseUnits('86000', 18),
    amountInMax: parseUnits('15', 6),
    fee: 10000,
  },
]

async function main() {
  const ctx = await loadContext()
  const account = ctx.account!
  const walletClient = ctx.walletClient!
  const publicClient = ctx.publicClient!

  console.log(`\nBuying tokens on Arc Mainnet using Uniswap V3 SwapRouter02 (${SWAP_ROUTER})`)
  console.log(`Buyer wallet: ${account}`)

  const usdcBal = await publicClient.readContract({
    address: USDC_ERC20,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account],
  })
  console.log(`Current USDC balance: ${formatUnits(usdcBal, 6)} USDC`)

  // Check allowance
  const allowance = await publicClient.readContract({
    address: USDC_ERC20,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account, SWAP_ROUTER],
  })

  if (allowance < parseUnits('100', 6)) {
    console.log(`Approving SwapRouter02 for USDC...`)
    const approveTx = await walletClient.writeContract({
      address: USDC_ERC20,
      abi: erc20Abi,
      functionName: 'approve',
      args: [SWAP_ROUTER, maxUint256],
      chain: ctx.chain,
      account: walletClient.account!,
    })
    console.log(`Approve tx submitted: ${approveTx}. Waiting for confirmation...`)
    const receipt = await publicClient.waitForTransactionReceipt({hash: approveTx})
    console.log(`Approve confirmed in block ${receipt.blockNumber}`)
  } else {
    console.log(`SwapRouter02 already approved for USDC.`)
  }

  for (const item of PURCHASES) {
    console.log(`\nSwapping USDC for exact ${formatUnits(item.amountOut, 18)} ${item.name}...`)
    try {
      const swapTx = await walletClient.writeContract({
        address: SWAP_ROUTER,
        abi: swapRouterAbi,
        functionName: 'exactOutputSingle',
        args: [
          {
            tokenIn: USDC_ERC20,
            tokenOut: item.address,
            fee: item.fee,
            recipient: account,
            amountOut: item.amountOut,
            amountInMaximum: item.amountInMax,
            sqrtPriceLimitX96: 0n,
          },
        ],
        chain: ctx.chain,
        account: walletClient.account!,
      })
      console.log(`  Tx submitted: ${swapTx}. Waiting for confirmation...`)
      const receipt = await publicClient.waitForTransactionReceipt({hash: swapTx})
      console.log(`  ✓ Confirmed in block ${receipt.blockNumber}`)

      const newBal = await publicClient.readContract({
        address: item.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
      })
      console.log(`  Holding now: ${formatUnits(newBal, 18)} ${item.name}`)
    } catch (err: any) {
      console.error(`  ✗ Error buying ${item.name}:`, err.message || err)
    }
  }

  console.log(`\n=== All swaps finished! ===`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
