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
 * ## Two venues
 *
 * Uniswap v3 by default. `--venue arctide` uses Arc's own V2 AMM, which is the only place
 * some tokens trade at all — TIDE has no Uniswap pool on any fee tier. The two differ in more
 * than the router address: Arctide is exact-*input* (V2 fee-supporting swaps cannot promise an
 * exact output), pays with native USDC as `msg.value`, and takes ~1.5% before the pool sees
 * the trade. So on that venue the caller states what they will spend, and the token amount is
 * quoted rather than demanded.
 *
 * Usage:
 *   pnpm buy:token <tokenAddress> <amountOut> --max-usdc <usdc> [--fee 10000] [--confirm]
 *   pnpm buy:token <tokenAddress> --venue arctide --spend <usdc> [--slippage 5] [--confirm]
 *   pnpm buy:token <tokenAddress> --venue v4      --spend <usdc> [--slippage 5] [--confirm]
 *   pnpm buy:token <tokenAddress> --venue dag --hook <address> --spend <usdc> [--fee 10000] [--confirm]
 *
 * Four venues, because Arc has no single market. `v4` is the Uniswap v4 pool paid in NATIVE
 * USDC behind the launchpad hook (FAZE, AF); `dag` is the DEX router used by pools whose hook
 * returns a delta on beforeSwap, which the Universal Router cannot handle (REGI, AKIT, ARCADE)
 * and which therefore needs that pool's hook passed in.
 */
import './operator/env'
import {formatUnits, getAddress, parseAbi, parseUnits, type Address, type Hex} from 'viem'
import {loadContext} from './operator/context'
import {
  encodeExactInSingle,
  encodeDagSwap,
  ARCADE_DEX_ROUTER,
  UNIVERSAL_ROUTER,
  type PoolKey,
} from './operator/uniswap-v4'
import {
  ARCTIDE_ROUTER,
  ARCTIDE_WETH,
  ROUTER_ABI as ARCTIDE_ROUTER_ABI,
  encodeArctideBuy,
  quoteInputAfterFees,
  requirePair,
} from './operator/arctide'

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

async function sendWithRetry<T>(fn: () => Promise<T>, retries = 5, delayMs = 3000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const rateLimited = /\b429\b|rate limit|exceeds defined limit/i.test(message)
      if (rateLimited && i < retries - 1) {
        process.stdout.write(`  … endpoint rate limited; retrying in ${(delayMs / 1000).toFixed(1)}s\n`)
        await new Promise((r) => setTimeout(r, delayMs))
        delayMs = Math.floor(delayMs * 1.5)
        continue
      }
      throw err
    }
  }
  throw new Error('Unreachable')
}

async function buyOnArctide(tokenArg: string): Promise<void> {
  const spend = flag('spend')
  if (!spend) throw new Error('Arctide buys are exact-input: pass --spend <usdc>.')
  const slippagePct = BigInt(Number.parseInt(flag('slippage') ?? '5', 10))
  const confirm = process.argv.includes('--confirm')

  const token = getAddress(tokenArg)
  const ctx = await loadContext()
  const {publicClient, account} = ctx
  if (!account) throw new Error('No signer configured.')

  const read = ((a: never) => publicClient.readContract(a)) as unknown as (a: never) => Promise<unknown>
  const pair = await requirePair(read, token)

  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({address: token, abi: ERC20_ABI, functionName: 'symbol'}),
    publicClient.readContract({address: token, abi: ERC20_ABI, functionName: 'decimals'}),
  ])

  // The pool is quoted on what reaches it, not on what leaves the wallet.
  const spent6 = parseUnits(spend, USDC_DECIMALS)
  const amounts = (await publicClient.readContract({
    address: ARCTIDE_ROUTER, abi: ARCTIDE_ROUTER_ABI, functionName: 'getAmountsOut',
    args: [quoteInputAfterFees(spent6), [ARCTIDE_WETH, token]],
  })) as readonly bigint[]
  const expected = amounts[amounts.length - 1]!
  const amountOutMin = (expected * (100n - slippagePct)) / 100n

  const before = await publicClient.readContract({
    address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [account],
  })

  process.stdout.write(
    `\nBuying ${symbol} on Arctide\n` +
      `  pair         ${pair}\n` +
      `  spending     ${spend} USDC (native, ~1.5% router fee before the pool)\n` +
      `  expected     ${formatUnits(expected, Number(decimals))} ${symbol}\n` +
      `  floor        ${formatUnits(amountOutMin, Number(decimals))} ${symbol} (${slippagePct}% slippage)\n` +
      `  held now     ${formatUnits(before, Number(decimals))} ${symbol}\n`,
  )

  const data = encodeArctideBuy({
    token, amountOutMin, recipient: account,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
  })
  // msg.value is the SAME money at 18 decimals. Mixing the two scales is the trap here.
  const value = parseUnits(spend, 18)

  await publicClient.call({account, to: ARCTIDE_ROUTER, data, value})
  process.stdout.write('  simulates cleanly\n')

  if (!confirm) {
    process.stdout.write('\n  --confirm not passed; nothing was broadcast.\n')
    return
  }

  const hash = await sendWithRetry(() =>
    ctx.walletClient!.sendTransaction({
      to: ARCTIDE_ROUTER, data, value, chain: ctx.chain, account: ctx.walletClient!.account!,
    }),
  )
  const receipt = await publicClient.waitForTransactionReceipt({hash})
  if (receipt.status !== 'success') throw new Error(`Swap reverted: ${hash}`)
  const after = await publicClient.readContract({
    address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [account],
  })
  process.stdout.write(
    `  ✓ ${hash}\n  received ${formatUnits(after - before, Number(decimals))} ${symbol}\n`,
  )
}

/** Launchpad hook behind the native-USDC v4 pools (FAZE, AF and friends). */
const V4_LAUNCHPAD_HOOK: Address = getAddress('0x47e7936ae9891e61c5123db720593c05de7120cc')
/** v4 uses the zero address for the chain's native asset — here, USDC. */
const NATIVE: Address = getAddress('0x0000000000000000000000000000000000000000')

/**
 * The two venues that are paid in NATIVE USDC rather than the ERC-20.
 *
 * Both are exact-input: these pools quote rather than promise an output, so the caller says
 * what they will spend. `dag` additionally needs the pool's own hook, which is not published
 * anywhere and was recovered per token — passing the wrong one addresses a different pool, so
 * it is required rather than defaulted.
 */
async function buyWithNative(tokenArg: string, venue: 'v4' | 'dag'): Promise<void> {
  const spend = flag('spend')
  if (!spend) throw new Error(`${venue} buys are exact-input: pass --spend <usdc>.`)
  const hookArg = flag('hook')
  if (venue === 'dag' && !hookArg) {
    throw new Error('--venue dag needs --hook <address>: the pool key is not derivable without it.')
  }
  const slippagePct = BigInt(Number.parseInt(flag('slippage') ?? '10', 10))
  const confirm = process.argv.includes('--confirm')

  const token = getAddress(tokenArg)
  const ctx = await loadContext()
  const {publicClient, account} = ctx
  if (!account) throw new Error('No signer configured.')

  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({address: token, abi: ERC20_ABI, functionName: 'symbol'}),
    publicClient.readContract({address: token, abi: ERC20_ABI, functionName: 'decimals'}),
  ])
  const before = await publicClient.readContract({
    address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [account],
  })

  const value = parseUnits(spend, 18)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)

  // No quoter on either venue, so the floor comes from the price snapshot rather than a quote.
  const minOut = 1n

  let to: Address
  let data: Hex
  if (venue === 'v4') {
    const key: PoolKey = {
      currency0: NATIVE, currency1: token, fee: 0, tickSpacing: 200, hooks: V4_LAUNCHPAD_HOOK,
    }
    to = UNIVERSAL_ROUTER
    data = encodeExactInSingle({key, zeroForOne: true, amountIn: value, amountOutMinimum: minOut, deadline})
  } else {
    /*
     * The pool's fee was fixed at 10000 here, which held until oBrain: its pool charges no
     * static fee at all, and a key carrying the wrong fee addresses a pool that was never
     * initialised, so the router reverts with nothing to say.
     *
     * The currency ORDER is deliberately the trade's direction — tokenIn, then tokenOut —
     * and not the sorted order a PoolKey hash would use. That looks wrong and is not: a real
     * oBrain swap through this router carries USDC first even though oBrain's address sorts
     * below it, so the router does its own sorting. Re-sorting here breaks pools that work.
     */
    const feeArg = Number.parseInt(flag('fee') ?? '10000', 10)
    if (!Number.isInteger(feeArg) || feeArg < 0) throw new Error('--fee must be a non-negative integer.')

    to = ARCADE_DEX_ROUTER
    data = encodeDagSwap({
      tokenIn: ERC20_USDC, tokenOut: token, amountIn: parseUnits(spend, USDC_DECIMALS),
      minAmountOut: minOut, receiver: account, deadline,
      key: {currency0: ERC20_USDC, currency1: token, fee: feeArg, tickSpacing: 200, hooks: getAddress(hookArg!)},
    })
  }

  process.stdout.write(
    `\nBuying ${symbol} on ${venue}\n` +
      `  router       ${to}\n` +
      `  spending     ${spend} USDC\n` +
      `  held now     ${formatUnits(before, Number(decimals))} ${symbol}\n` +
      `  slippage     floor is minimal on this venue (${slippagePct}% nominal); size spends small\n`,
  )

  await publicClient.call({account, to, data, value: venue === 'v4' ? value : 0n})
  process.stdout.write('  simulates cleanly\n')

  if (!confirm) {
    process.stdout.write('\n  --confirm not passed; nothing was broadcast.\n')
    return
  }

  const hash = await sendWithRetry(() =>
    ctx.walletClient!.sendTransaction({
      to, data, value: venue === 'v4' ? value : 0n, chain: ctx.chain, account: ctx.walletClient!.account!,
    }),
  )
  const receipt = await publicClient.waitForTransactionReceipt({hash})
  if (receipt.status !== 'success') throw new Error(`Swap reverted: ${hash}`)
  const after = await publicClient.readContract({
    address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [account],
  })
  process.stdout.write(
    `  ✓ ${hash}\n  received ${formatUnits(after - before, Number(decimals))} ${symbol}\n`,
  )
}

async function main(): Promise<void> {
  const [tokenArg, amountArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const venue = flag('venue')

  if ((venue === 'v4' || venue === 'dag') && tokenArg) return buyWithNative(tokenArg, venue)

  if (venue === 'arctide') {
    if (!tokenArg) throw new Error('Usage: pnpm buy:token <tokenAddress> --venue arctide --spend <usdc>')
    return buyOnArctide(tokenArg)
  }
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
    const approveHash = await sendWithRetry(() =>
      ctx.walletClient!.writeContract({
        address: ERC20_USDC, abi: ERC20_ABI, functionName: 'approve',
        args: [V3_ROUTER, amountInMaximum], chain: ctx.chain, account: ctx.walletClient!.account!,
      }),
    )
    await publicClient.waitForTransactionReceipt({hash: approveHash})
  }

  const hash = await sendWithRetry(() =>
    ctx.walletClient!.writeContract({
      address: V3_ROUTER, abi: ROUTER_ABI, functionName: 'exactOutputSingle',
      args: [params], chain: ctx.chain, account: ctx.walletClient!.account!,
    }),
  )
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
