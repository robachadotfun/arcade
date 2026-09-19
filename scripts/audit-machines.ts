/**
 * audit-machines.ts
 *
 * Runs the machine risk review from the command line, so the economics can be checked
 * before a deployment rather than only in the browser at `/admin`.
 *
 * ## What this answers
 *
 *   1. Are the reward tables structurally sound? — odds sum, every token in the verified
 *      registry, no empty tables, no inverted bands. No prices involved.
 *   2. What inventory does each machine require? — worst-case payable units per token,
 *      which is exactly what `pnpm operator fund` has to deposit before the contract will
 *      accept a spin. Also price-free.
 *   3. Is the machine profitable? — only answerable with prices, which are NOT fetched.
 *
 * ## Why prices are not fetched
 *
 * Arc reward assets are thin. Pulling a spot price from a screener and feeding it into a
 * solvency decision produces a confident number resting on a quote that may not survive the
 * trade. The hard checks below work in token units where no price exists. Expected value is
 * advisory, and only computed from a price file the operator supplies deliberately:
 *
 *   pnpm machine:audit --prices scripts/data/prices.json
 *
 * where the file is `{"prices": {"0xabc…": 0.0123}, "capturedAt": "…", "source": "…"}`.
 *
 * Exit code is non-zero if any machine has a blocking finding, so this can gate a deploy.
 *
 * Usage: pnpm machine:audit [--prices <file>]
 */

import {existsSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {LIVE_MACHINES, MACHINES, totalWeight, rarityOdds} from '../src/config/machines'
import {assetByAddress} from '../src/config/rewards'
import {
  evaluateMachine,
  formatUnitsShort,
  RISK_LABEL,
  SAFETY,
  type PriceSnapshot,
} from '../src/lib/economics'

function out(line = ''): void {
  process.stdout.write(`${line}\n`)
}

function rule(text: string): void {
  out(`\n${text}`)
  out('─'.repeat(Math.max(text.length, 40)))
}

/** Reads a price file if one was supplied. Absent prices are reported, never invented. */
function loadPrices(): PriceSnapshot {
  const flag = process.argv.indexOf('--prices')
  if (flag === -1) {
    return {prices: {}, capturedAt: 'not supplied', source: 'none'}
  }
  const path = process.argv[flag + 1]
  if (!path) {
    process.stderr.write('--prices needs a file path\n')
    process.exit(2)
  }
  const full = resolve(path)
  if (!existsSync(full)) {
    process.stderr.write(`No price file at ${full}\n`)
    process.exit(2)
  }
  const parsed = JSON.parse(readFileSync(full, 'utf8')) as Partial<PriceSnapshot>
  const prices: Record<string, number> = {}
  for (const [address, price] of Object.entries(parsed.prices ?? {})) {
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      prices[address.toLowerCase()] = price
    }
  }
  return {
    prices,
    capturedAt: parsed.capturedAt ?? 'unknown',
    source: parsed.source ?? full,
  }
}

function main(): void {
  const snapshot = loadPrices()

  out('Arcade machine audit')
  out(`  machines          ${LIVE_MACHINES.length} live of ${MACHINES.length} configured`)
  out(`  prices            ${Object.keys(snapshot.prices).length} supplied (${snapshot.source})`)
  out(`  payout ceiling    ${(SAFETY.maxPayoutRatio * 100).toFixed(0)}% of spin revenue`)
  out(`  liability basis   ${SAFETY.assumedConcurrentSpins} concurrent worst-case spins`)

  let blockingTotal = 0
  let warnTotal = 0

  // Funding requirements accumulate across machines: the vault is shared, so a token used by
  // two machines has to cover the worst case of both at once.
  const funding = new Map<string, {symbol: string; units: number}>()

  for (const machine of MACHINES) {
    if (machine.status === 'disabled') continue

    const economics = evaluateMachine(machine, snapshot)

    rule(`${machine.name}  —  ${machine.spinPriceUsdc} USDC/spin  —  ${RISK_LABEL[economics.risk]}`)

    // ---------------------------------------------------------------- structure
    const weights = totalWeight(machine)
    const odds = rarityOdds(machine)
    // Probabilities are weight/totalWeight, so they sum to 1 by construction. What is worth
    // checking is that the rarity bands account for all of it — a tier with a rarity outside
    // the enum, or a zero-weight tier, would show up as a shortfall here.
    const bandSum = odds.reduce((acc, band) => acc + band.probability, 0)
    out(`  tiers             ${machine.tiers.length}`)
    out(`  total weight      ${weights.toLocaleString('en-US')}`)
    out(
      `  rarity bands sum  ${(bandSum * 100).toFixed(4)}%` +
        `${Math.abs(bandSum - 1) > 1e-9 ? '   ← DOES NOT ACCOUNT FOR EVERY TIER' : ''}`,
    )
    for (const band of odds) {
      if (band.probability <= 0) continue
      out(`    ${band.rarity.padEnd(9)} ${(band.probability * 100).toFixed(3)}%`)
    }

    // ------------------------------------------------------------- profitability
    if (economics.payoutRatio !== null) {
      out(
        `  expected payout   $${economics.expectedPayoutUsd?.toFixed(4)} ` +
          `(${(economics.payoutRatio * 100).toFixed(1)}% of revenue)`,
      )
      out(`  margin per spin   $${economics.marginUsd?.toFixed(4)}`)
    } else {
      out(
        `  expected payout   unknown — ${economics.priceCoverage.known}/${economics.priceCoverage.total} ` +
          'token prices supplied',
      )
    }

    // --------------------------------------------------------------- liabilities
    out('  worst case per spin, and inventory needed to accept spins:')
    for (const liability of economics.liabilities) {
      const perSpin = liability.worstCasePerSpin
      const total = liability.worstCaseTotal
      out(
        `    ${liability.symbol.padEnd(9)} ${formatUnitsShort(perSpin).padStart(14)}` +
          `   x${SAFETY.assumedConcurrentSpins} = ${formatUnitsShort(total).padStart(14)}`,
      )
      const key = liability.address.toLowerCase()
      const existing = funding.get(key)
      funding.set(key, {
        symbol: liability.symbol,
        units: (existing?.units ?? 0) + total,
      })
    }

    // ------------------------------------------------------- break-even basket
    //
    // Prices are unknown, but the basket is not. Every spin pays out, on average, a fixed
    // quantity of each token — that is pure arithmetic over the published table. So the
    // profitability question inverts into one the operator can actually check against a
    // market: "is this basket worth less than the ceiling?"
    out(`  average payout per spin, in token units:`)
    for (const tier of economics.tiers) {
      const expectedUnits = tier.probability * tier.meanAmount
      if (expectedUnits <= 0) continue
      out(
        `    ${tier.symbol.padEnd(9)} ${formatUnitsShort(expectedUnits).padStart(14)}` +
          `   (${(tier.probability * 100).toFixed(3)}% x ${formatUnitsShort(tier.meanAmount)})`,
      )
    }
    const ceiling = Number.parseFloat(machine.spinPriceUsdc) * SAFETY.maxPayoutRatio
    out(
      `  This basket must be worth less than $${ceiling.toFixed(2)} ` +
        `(${(SAFETY.maxPayoutRatio * 100).toFixed(0)}% of the ${machine.spinPriceUsdc} USDC spin price).`,
    )
    out(`  Priced above that, the machine loses money on every spin by design.`)

    // ------------------------------------------------------------------ findings
    if (economics.findings.length === 0) {
      out('  findings          none')
    } else {
      out('  findings:')
      for (const finding of economics.findings) {
        const mark = finding.blocking ? '✗ BLOCKING' : finding.level === 'warn' ? '! warn' : '·'
        out(`    ${mark}  ${finding.message}`)
        if (finding.blocking) blockingTotal += 1
        else if (finding.level === 'warn') warnTotal += 1
      }
    }
  }

  // ------------------------------------------------------------ funding summary
  rule('Minimum inventory to deposit before any spin is accepted')
  out('  ArcadeMachineManager checks worst-case liability for every token on every spin and')
  out('  rejects one it cannot cover. These are floors, not recommendations — a machine with')
  out(`  exactly this much has ${SAFETY.assumedConcurrentSpins} spins of runway.`)
  out('')
  const sorted = [...funding.entries()].sort((a, b) => a[1].symbol.localeCompare(b[1].symbol))
  for (const [address, {symbol, units}] of sorted) {
    const asset = assetByAddress(address as `0x${string}`)
    out(
      `  pnpm operator fund ${symbol.padEnd(9)} ${formatUnitsShort(units).padEnd(14)}` +
        `  # ${asset ? `${asset.decimals}dp` : 'UNVERIFIED TOKEN'}  ${address}`,
    )
  }
  out('')
  out(`  For ${SAFETY.minRunwaySpins} spins of runway, multiply by ` +
    `${(SAFETY.minRunwaySpins / SAFETY.assumedConcurrentSpins).toFixed(1)}.`)

  // --------------------------------------------------------------------- verdict
  rule('Verdict')
  if (blockingTotal > 0) {
    out(`  ${blockingTotal} blocking finding(s). These machines must not be activated as configured.`)
    process.exit(1)
  }
  if (Object.keys(snapshot.prices).length === 0) {
    out('  No blocking structural findings.')
    out('')
    out('  Profitability was NOT checked: no prices were supplied, so expected value could')
    out('  not be computed for any machine. A table can be structurally perfect and still')
    out('  pay out more than it takes in.')
    out('')
    out('  Price the per-spin baskets above against a market you trust, or re-run with')
    out('  --prices, before pointing this at mainnet. This is the one check that stands')
    out('  between a working deployment and one that loses money on every spin.')
    process.exit(0)
  }
  out(`  No blocking findings. ${warnTotal} warning(s).`)
}

main()
