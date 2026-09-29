import type {Address, Hex} from 'viem'

/**
 * Buying reward inventory through Tower, a DEX aggregator on Arc.
 *
 * ## Why this exists
 *
 * Arc has no single market, and acquiring inventory has meant carrying a hand-built route per
 * venue: Uniswap v3, the v4 launchpad hook, Arctide's V2 fork, AchSwap's adapter, and the DEX
 * router used by pools whose hook returns a delta on `beforeSwap`. Three of those five were
 * recovered by decoding real transactions because nothing published described them. Each new
 * token then needs its PoolKey found from an `Initialize` event and checked by re-deriving the
 * pool id, and twice now a field that looked constant turned out not to be — the fee, which
 * oBrain's pool sets to zero, and the tick spacing, which UBI's pool sets to 60.
 *
 * An aggregator that already knows the routes removes all of that.
 *
 * ## The safety argument, which matters more than the convenience one
 *
 * `buy:token --venue dag` sends `amountOutMinimum = 1`. There is no quoter on that route, so
 * there is no floor: a swap executes at whatever the pool gives, including nothing. That has
 * been acceptable only because the amounts are small and the pools were checked by hand first.
 *
 * Tower returns a real `minOut` derived from a slippage tolerance, so this venue is the first
 * one here that can refuse a bad fill. That is the reason to prefer it, ahead of not having to
 * decode calldata.
 *
 * ## What this module will not do
 *
 * It will not broadcast anything it has not simulated. The transaction is built by a third
 * party, and the only way to know that the returned calldata does what the quote described is
 * to run it against live state and read what comes back. {@link assertQuoteIsSane} additionally
 * rejects a quote whose own numbers disagree with each other, so a malformed or hostile
 * response fails before it reaches a signer rather than after.
 *
 * Docs: https://docs.tower.exchange/developer-console/api-reference/swap-engine
 */

const BASE = 'https://www.tower.exchange/api/public/swap'

/** Arc Mainnet. The quote endpoint defaults to this; passed explicitly so it cannot drift. */
export const ARC_CHAIN_ID = 5042

export type TowerQuote = {
  inputToken: Address
  outputToken: Address
  /**
   * These three are NOT the token's atomic units, despite what the API reference calls them.
   * They are normalised to 18 decimals; the `*Native` fields below carry the real amounts.
   * See {@link nativeAmounts}.
   */
  inputAmount: string
  outputAmount: string
  minOut: string
  inputAmountNative?: string
  outputAmountNative?: string
  minOutNative?: string
  priceImpact: number
  gasEstimate: string
  feeBps: number
  dexId: string
  dexName: string
  route?: unknown
}

export type TowerTx = {
  to: Address
  data: Hex
  value?: string
  from?: Address
  gasLimit?: string
  chainId?: number
}

export type TowerBuild = {
  /** Present only when the input token still needs an allowance for Tower's executor. */
  approval?: TowerTx
  swap: TowerTx
}

export class TowerError extends Error {}

function apiKey(): string {
  const key = process.env.TOWER_API_KEY
  if (!key) {
    throw new TowerError(
      'TOWER_API_KEY is not set. Create a key at https://devs.tower.exchange and add it to\n' +
        '.env.local as TOWER_API_KEY=... — it is a server-side credential, so it must NOT be\n' +
        'given a NEXT_PUBLIC_ prefix or it will be bundled into the website.',
    )
  }
  return key
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-api-key': apiKey()},
    body: JSON.stringify(body),
  })
  const text = await res.text()

  let parsed: {success?: boolean; data?: T; error?: string}
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    throw new TowerError(`Tower ${path} returned ${res.status} with a non-JSON body: ${text.slice(0, 200)}`)
  }

  if (!res.ok || parsed.success === false || !parsed.data) {
    throw new TowerError(`Tower ${path} failed (${res.status}): ${parsed.error ?? text.slice(0, 200)}`)
  }
  return parsed.data
}

/**
 * Prices a swap. `inputAmount` is in the input token's atomic units — for the USDC ERC-20 on
 * Arc that is 6 decimals, not the 18 the native asset uses.
 */
export async function quote({
  inputToken,
  outputToken,
  inputAmount,
  slippageBps = 100,
  dexId,
}: {
  inputToken: Address
  outputToken: Address
  inputAmount: bigint
  slippageBps?: number
  dexId?: string
}): Promise<TowerQuote> {
  return post<TowerQuote>('quote', {
    inputToken,
    outputToken,
    inputAmount: inputAmount.toString(),
    slippageTolerance: slippageBps,
    chainId: ARC_CHAIN_ID,
    ...(dexId ? {dexId} : {}),
  })
}

/** Turns a quote into unsigned calldata. Never broadcast the result without simulating it. */
export async function buildTx(quoteData: TowerQuote, userAddress: Address): Promise<TowerBuild> {
  const built = await post<TowerBuild | TowerTx>('build-tx', {quote: quoteData, userAddress})
  // The documented response nests the swap under `swap`; tolerate a bare transaction too
  // rather than failing on a shape difference that does not change what gets executed.
  if ('swap' in built && built.swap) return built as TowerBuild
  return {swap: built as TowerTx}
}

/**
 * The amounts in each token's own decimals.
 *
 * Tower returns every figure twice. `outputAmount` and `minOut` are rescaled to 18 decimals,
 * and `outputAmountNative` / `minOutNative` are the token's actual atomic units. The API
 * reference describes the first pair as "atomic units", which is what makes this worth a
 * named function rather than a field access: asking for 1 USDC of EURC returns
 * `minOut: 871411000000000000` and `minOutNative: 871411`, and EURC has six decimals. Treating
 * the former as a floor asks for 871 million EURC, which no swap can meet, so the trade
 * reverts — or worse, the same confusion in the other direction sets a floor of nearly zero.
 *
 * The `*Native` values are preferred wherever present, and the rescaled ones are used only as
 * a fallback for a response shape that does not include them.
 */
export function nativeAmounts(q: TowerQuote): {inputAmount: bigint; outputAmount: bigint; minOut: bigint} {
  return {
    inputAmount: BigInt(q.inputAmountNative ?? q.inputAmount),
    outputAmount: BigInt(q.outputAmountNative ?? q.outputAmount),
    minOut: BigInt(q.minOutNative ?? q.minOut),
  }
}

/**
 * Rejects a quote whose own figures do not agree, before any of it reaches a signer.
 *
 * A quote is a claim made by someone else about a trade this process is about to pay for. The
 * cheap checks are worth running because every one of them has a plausible failure behind it:
 * a wrong-way route, a response for a different pair, a `minOut` that permits an arbitrary
 * fill, or a price impact large enough that the trade is moving the market rather than taking
 * a price from it.
 */
export function assertQuoteIsSane(
  q: TowerQuote,
  expect: {inputToken: Address; outputToken: Address; inputAmount: bigint; maxPriceImpactPct: number},
): void {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

  if (!same(q.inputToken, expect.inputToken) || !same(q.outputToken, expect.outputToken)) {
    throw new TowerError(
      `Tower quoted a different pair than asked for: ${q.inputToken} -> ${q.outputToken}`,
    )
  }
  if (nativeAmounts(q).inputAmount !== expect.inputAmount) {
    throw new TowerError(
      `Tower quoted a different input: asked ${expect.inputAmount}, quoted ${nativeAmounts(q).inputAmount}`,
    )
  }

  const {outputAmount: out, minOut: min} = nativeAmounts(q)
  if (out <= 0n) throw new TowerError('Tower quoted a zero output.')
  if (min <= 0n) {
    throw new TowerError('Tower quoted minOut = 0, which is no floor at all; refusing the route.')
  }
  if (min > out) {
    throw new TowerError(`Tower quoted minOut (${min}) above outputAmount (${out}).`)
  }
  if (Number.isFinite(q.priceImpact) && q.priceImpact > expect.maxPriceImpactPct) {
    throw new TowerError(
      `Price impact ${q.priceImpact}% exceeds the ${expect.maxPriceImpactPct}% limit. ` +
        'Size the buy smaller or pass a higher --max-impact.',
    )
  }
}
