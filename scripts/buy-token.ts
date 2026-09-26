/**
 * buy-token.ts — acquire reward inventory through Uniswap v3 on Arc.
 *
 * `acquire-all-tokens.ts` hardcodes one block per token, which was fine while the set was
 * fixed and is not once rewards are added routinely. This takes the token and the amount as
 * arguments instead, so restocking is a command rather than an edit.
 *
 * ## Exact output, not exact input
 *
 * The caller says how many tokens they need — which is the number the vault actually has to
 * hold to cover a machine's worst-case payout — and caps what they will pay for them. Sizing
 * by USDC in would mean discovering the token count afterwards and hoping it covered the band.
 *
 * ## What it refuses to do
 *
 *   - spend without simulating first, so a bad pool or fee tier fails before it costs gas
 *   - proceed without `--max-usdc`, since an uncapped buy in a thin pool is an invitation
 *   - broadcast without `--confirm`
 *
 * Usage:
 *   pnpm buy:token <tokenAddress> <amountOut> --max-usdc <usdc> [--fee 10000] [--confirm]
 */
import './operator/env'
import {formatUnits, getAddress, parseAbi, parseUnits, type Address} from 'viem'
import {loadContext} from './operator/context'

/** Uniswap v3 SwapRouter02 on Arc, the router the existing inventory buys already use. */
const V3_ROUTER: Address = getAddress('0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77')
/** The 6-decimal USDC ERC-20 interface. The v3 pools quote against this, not the native asset. */
const ERC20_USDC: Address = getAddress('0x3600000000000000000000000000000000000000')
const USDC_DECIMALS = 6

const ROUTER_ABI = parseAbi([
  'function exactOutputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountOut,uint256 amountInMaximum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountIn)',
])
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
])

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<void> {
  const [tokenArg, amountArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const maxUsdcArg = flag('max-usdc')
  const fee = Number.parseInt(flag('fee') ?? '10000', 10)
  const confirm = process.argv.includes('--confirm')

  if (!tokenArg || !amountArg || !maxUsdcArg) {
    throw new Error(
      'Usage: pnpm buy:token <tokenAddress> <amountOut> --max-usdc <usdc> [--fee 10000] [--confirm]',
    )
  }

  const token = getAddress(tokenArg)
  const ctx = await loadContext()
  const {publicClient, account} = ctx
  if (!account) throw new Error('No signer configured.')

  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({address: token, abi: ERC20_ABI, functionName: 'symbol'}),
    publicClient.readContract({address: token, abi: ERC20_ABI, functionName: 'decimals'}),
  ])

  const amountOut = parseUnits(amountArg, Number(decimals))
  const amountInMaximum = parseUnits(maxUsdcArg, USDC_DECIMALS)

  const before = await publicClient.readContract({
    address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [account],
  })

  process.stdout.write(
    `\nBuying ${amountArg} ${symbol}\n` +
      `  token        ${token}\n` +
      `  router       ${V3_ROUTER} (Uniswap v3, fee ${fee})\n` +
      `  paying up to ${maxUsdcArg} USDC\n` +
      `  held now     ${formatUnits(before, Number(decimals))} ${symbol}\n`,
  )

  const params = {
    tokenIn: ERC20_USDC,
    tokenOut: token,
    fee,
    recipient: account,
    amountOut,
    amountInMaximum,
    sqrtPriceLimitX96: 0n,
  } as const

  // Simulated before anything is sent: a wrong fee tier or an absent pool fails here, free.
  const sim = await publicClient.simulateContract({
    address: V3_ROUTER, abi: ROUTER_ABI, functionName: 'exactOutputSingle', account, args: [params],
  })
  process.stdout.write(`  quote        ${formatUnits(sim.result as bigint, USDC_DECIMALS)} USDC\n`)

  if (!confirm) {
    process.stdout.write('\n  --confirm not passed; nothing was broadcast.\n')
    return
  }

  const allowance = await publicClient.readContract({
    address: ERC20_USDC, abi: ERC20_ABI, functionName: 'allowance', args: [account, V3_ROUTER],
  })
  if (allowance < amountInMaximum) {
    process.stdout.write('  → approving USDC for the router\n')
    const approveHash = await ctx.walletClient!.writeContract({
      address: ERC20_USDC, abi: ERC20_ABI, functionName: 'approve',
      args: [V3_ROUTER, amountInMaximum], chain: ctx.chain, account: ctx.walletClient!.account!,
    })
    await publicClient.waitForTransactionReceipt({hash: approveHash})
  }

  const hash = await ctx.walletClient!.writeContract({
    address: V3_ROUTER, abi: ROUTER_ABI, functionName: 'exactOutputSingle',
    args: [params], chain: ctx.chain, account: ctx.walletClient!.account!,
  })
  const receipt = await publicClient.waitForTransactionReceipt({hash})
  if (receipt.status !== 'success') throw new Error(`Swap reverted: ${hash}`)

  const after = await publicClient.readContract({
    address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [account],
  })
  process.stdout.write(
    `  ✓ ${hash}\n  received ${formatUnits(after - before, Number(decimals))} ${symbol}\n`,
  )
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
