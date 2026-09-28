/* eslint-disable no-console */
/**
 * check-bands.ts — does each reward still pay what its tier intends?
 *
 * Reward bands are fixed in TOKENS; the value they pay is the band times a price nobody
 * controls. So a machine's economics drift on their own, with nothing in the config changing
 * and nothing in `status` noticing. Both directions have already happened here:
 *
 *   - ARCADE rose ~35% and its band quietly grew to $1.68–$3.35 against a ~$0.95–$2.00 tier,
 *     taking the machine's payout ratio from 77.7% to 81.0%
 *   - COOL fell ~28% and its band shrank to $0.64–$1.31, paying winners less than every other
 *     common for the same odds
 *
 * The first costs the operator, the second costs players, and neither announces itself. This
 * reads live prices and prints the drift, so the check is a command instead of someone
 * remembering.
 *
 * Read-only. It suggests amounts and changes nothing.
 *
 * Usage: pnpm check:bands [--machine discovery] [--tolerance 15]
 */
import './operator/env'
import {MACHINES, totalWeight, type MachineConfig} from '../src/config/machines'
import {assetByAddress, labelFor} from '../src/config/rewards'

/** What a common tier is meant to pay, in USD. The other bands scale from the same shape. */
const TARGET_LOW = 0.95
const TARGET_HIGH = 2.0

type Pair = {baseToken?: {address?: string}; priceUsd?: string; liquidity?: {usd?: number}}

async function livePrices(addresses: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const liquidity = new Map<string, number>()

  function absorb(pairs: Pair[]) {
    for (const pair of pairs) {
      const addr = pair.baseToken?.address?.toLowerCase()
      const price = Number.parseFloat(pair.priceUsd ?? '')
      if (!addr || !Number.isFinite(price)) continue
      // Several pairs per token: keep the deepest, which is the one a winner would sell into.
      const liq = pair.liquidity?.usd ?? 0
      if (liq > (liquidity.get(addr) ?? -1)) {
        out.set(addr, price)
        liquidity.set(addr, liq)
      }
    }
  }

  async function fetchBatch(batch: string[]): Promise<Pair[]> {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${batch.join(',')}`)
    const body = (await res.json()) as {pairs?: Pair[]}
    return body.pairs ?? []
  }

  /*
   * DexScreener caps a response at 30 PAIRS, not 30 tokens — and a token can have several
   * pairs. Ask for 25 addresses at once and the reply silently truncates: the tokens that
   * fall off the end come back with no price, which this script then reported as "no live
   * price" and left out of the payout ratio entirely. That is the one failure mode a drift
   * check must not have, because a band nobody priced is exactly a band nobody corrected.
   * BCAT was dropped this way while its band was live.
   *
   * So the batch is small, and — more to the point — anything still missing is re-asked for
   * on its own. That second pass is what makes this correct rather than merely likelier to
   * work, since it does not depend on guessing how many pairs a token happens to have.
   */
  for (let i = 0; i < addresses.length; i += 10) {
    absorb(await fetchBatch(addresses.slice(i, i + 10)))
    await new Promise((r) => setTimeout(r, 400))
  }

  for (const addr of addresses) {
    if (out.has(addr)) continue
    absorb(await fetchBatch([addr]))
    await new Promise((r) => setTimeout(r, 400))
  }

  return out
}

function report(machine: MachineConfig, prices: Map<string, number>, tolerancePct: number) {
  const total = totalWeight(machine)
  console.log(`\n${machine.name} (${machine.slug}) — $${machine.spinPriceUsdc} a spin\n`)
  console.log(
    `  ${'token'.padEnd(10)}${'odds'.padStart(7)}  ${'rarity'.padEnd(8)}${'pays now'.padStart(18)}  drift`,
  )

  let expected = 0
  const drifted: string[] = []

  for (const tier of machine.tiers) {
    const addr = tier.token.toLowerCase()
    const asset = assetByAddress(tier.token)
    const symbol = asset ? labelFor(asset) : addr.slice(0, 10)
    const price = prices.get(addr)
    const odds = tier.weight / total

    if (price === undefined) {
      console.log(`  ${symbol.padEnd(10)}${(odds * 100).toFixed(1).padStart(6)}%  ${tier.rarity.padEnd(8)}${'no live price'.padStart(18)}`)
      continue
    }

    const low = Number.parseFloat(tier.minAmount) * price
    const high = Number.parseFloat(tier.maxAmount) * price
    expected += ((low + high) / 2) * odds

    // Only commons carry the published target; rarer tiers are meant to pay more.
    const band = `$${low.toFixed(2)}–$${high.toFixed(2)}`
    let note = ''
    if (tier.rarity === 'common') {
      const lowOff = ((low - TARGET_LOW) / TARGET_LOW) * 100
      const highOff = ((high - TARGET_HIGH) / TARGET_HIGH) * 100
      const worst = Math.abs(lowOff) > Math.abs(highOff) ? lowOff : highOff
      if (Math.abs(worst) > tolerancePct) {
        note = `${worst > 0 ? '+' : ''}${worst.toFixed(0)}%  -> ${Math.round(TARGET_LOW / price)}–${Math.round(TARGET_HIGH / price)}`
        drifted.push(symbol)
      }
    }
    console.log(
      `  ${symbol.padEnd(10)}${(odds * 100).toFixed(1).padStart(6)}%  ${tier.rarity.padEnd(8)}${band.padStart(18)}  ${note}`,
    )
  }

  const price = Number.parseFloat(machine.spinPriceUsdc)
  console.log(
    `\n  expected payout $${expected.toFixed(4)} per $${machine.spinPriceUsdc} spin = ${((expected / price) * 100).toFixed(1)}% of revenue`,
  )
  if (drifted.length) {
    console.log(`  drifted beyond ${tolerancePct}%: ${drifted.join(', ')}`)
    console.log('  the suggested amounts restore $0.95–$2.00 at the live price')
  } else {
    console.log(`  every common within ${tolerancePct}% of its intended band`)
  }
}

async function main() {
  const only = process.argv.includes('--machine')
    ? process.argv[process.argv.indexOf('--machine') + 1]
    : undefined
  const tolerance = process.argv.includes('--tolerance')
    ? Number.parseFloat(process.argv[process.argv.indexOf('--tolerance') + 1] ?? '15')
    : 15

  const machines = MACHINES.filter((m) => m.status === 'live' && (!only || m.slug === only))
  const addresses = [
    ...new Set(machines.flatMap((m) => m.tiers.map((t) => t.token.toLowerCase()))),
  ]

  console.log(`Reward band drift — live prices from DexScreener, tolerance ${tolerance}%`)
  const prices = await livePrices(addresses)
  for (const m of machines) report(m, prices, tolerance)
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 1
})
