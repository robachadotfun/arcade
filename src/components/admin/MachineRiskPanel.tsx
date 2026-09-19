'use client'

import {useMemo, useState} from 'react'
import {useReadContracts} from 'wagmi'
import {formatUnits} from 'viem'
import {prizeVaultAbi} from '@/abi'
import {Label, SectionHead, Pill, DataRow, Button} from '../ui/Primitives'
import {MACHINES, demoConfigFingerprint, totalWeight, type MachineConfig} from '@/config/machines'
import {REWARD_ASSETS} from '@/config/rewards'
import {resolveMode, isLiveMode} from '@/config/mode'
import {
  evaluateMachine,
  SAFETY,
  RISK_LABEL,
  formatUnitsShort,
  type PriceSnapshot,
  type RiskLevel,
} from '@/lib/economics'
import {formatPercent} from '@/lib/format'

const RISK_TONE: Record<RiskLevel, 'live' | 'warn' | 'stop'> = {
  ok: 'live',
  warn: 'warn',
  critical: 'stop',
}

/**
 * The machine risk review.
 *
 * This is the screen that stops an operator shipping a machine that loses money on every
 * spin, or one that can accept a spin it cannot pay out. A version with any blocking finding
 * cannot be confirmed for activation.
 *
 * Prices are entered by hand, not fetched. Arc reward assets are thin and volatile, and
 * quietly pulling a spot price into a solvency decision would produce a confident number
 * built on unreliable data. Expected value is advisory; the hard inventory check works in
 * token units where no price is involved.
 */
export function MachineRiskPanel() {
  const status = resolveMode()
  const contracts = status.kind === 'ready' ? status.contracts : null
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState<string | null>(null)

  // Live vault inventory, when contracts are configured.
  const inventoryQueries = useMemo(() => {
    if (!contracts || !isLiveMode(status.mode)) return []
    return REWARD_ASSETS.map(
      (asset) =>
        ({
          address: contracts.prizeVault,
          abi: prizeVaultAbi,
          functionName: 'availableOf',
          args: [asset.address],
        }) as const,
    )
  }, [contracts, status.mode])

  const {data: inventoryData} = useReadContracts({
    contracts: inventoryQueries,
    query: {enabled: inventoryQueries.length > 0, refetchInterval: 30_000},
  })

  const inventory = useMemo(() => {
    if (!inventoryData) return undefined
    const map: Record<string, number> = {}
    REWARD_ASSETS.forEach((asset, i) => {
      const result = inventoryData[i]
      if (result?.status === 'success') {
        map[asset.address.toLowerCase()] = Number.parseFloat(
          formatUnits(result.result as bigint, asset.decimals),
        )
      }
    })
    return map
  }, [inventoryData])

  const snapshot: PriceSnapshot = useMemo(() => {
    const parsed: Record<string, number> = {}
    for (const [address, raw] of Object.entries(prices)) {
      const value = Number.parseFloat(raw)
      if (Number.isFinite(value) && value > 0) parsed[address.toLowerCase()] = value
    }
    return {
      prices: parsed,
      capturedAt: new Date().toISOString(),
      source: 'operator-entered',
    }
  }, [prices])

  return (
    <section>
      <SectionHead
        eyebrow="Risk"
        title="Before you activate a version."
        lede="Every machine is evaluated against the same checks. A version with a blocking finding cannot be confirmed."
      />

      {/* --------------------------------------------------------------- price input */}
      <div className="mt-10 border border-hairline bg-paper-deep/40 p-5">
        <Label>Price snapshot (operator-entered)</Label>
        <p className="mt-3 max-w-[70ch] text-[0.875rem] leading-relaxed text-ink-soft">
          Enter USD prices to compute expected value. Left blank, EV is reported as unknown
          rather than guessed. Nothing here is fetched automatically: the reward assets are thin
          enough that a spot price pulled into a solvency decision would be a liability, and the
          hard inventory check below needs no price at all.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {REWARD_ASSETS.map((asset) => (
            <label key={asset.address} className="block">
              <span className="micro block text-ink-faint">{asset.symbol}</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="USD"
                value={prices[asset.address] ?? ''}
                onChange={(e) =>
                  setPrices((prev) => ({...prev, [asset.address]: e.target.value}))
                }
                className="mt-1.5 h-9 w-full border border-hairline-strong bg-paper px-2.5 font-mono text-[0.8125rem] text-ink outline-none focus-visible:border-arc"
              />
            </label>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------------ machines */}
      <div className="mt-12 flex flex-col gap-10">
        {MACHINES.map((machine) => (
          <MachineCard
            key={machine.slug}
            machine={machine}
            snapshot={snapshot}
            inventory={inventory}
            confirmed={confirmed === machine.slug}
            onConfirm={() => setConfirmed(machine.slug)}
            onReset={() => setConfirmed(null)}
          />
        ))}
      </div>
    </section>
  )
}

function MachineCard({
  machine,
  snapshot,
  inventory,
  confirmed,
  onConfirm,
  onReset,
}: {
  machine: MachineConfig
  snapshot: PriceSnapshot
  inventory: Record<string, number> | undefined
  confirmed: boolean
  onConfirm: () => void
  onReset: () => void
}) {
  const economics = evaluateMachine(machine, snapshot, inventory)
  const blocked = economics.blocking.length > 0

  return (
    <article className="border border-hairline bg-paper-raised">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-hairline p-5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="font-display text-[1.375rem] leading-none text-ink">{machine.name}</h3>
          <span className="font-mono text-[0.75rem] text-ink-faint">
            {demoConfigFingerprint(machine)}
          </span>
        </div>
        <Pill tone={RISK_TONE[economics.risk]}>{RISK_LABEL[economics.risk]}</Pill>
      </header>

      <div className="grid gap-8 p-5 md:grid-cols-3">
        {/* ---------------------------------------------------------------- economics */}
        <div>
          <Label>Economics</Label>
          <dl className="mt-3 divide-y divide-hairline-faint border-y border-hairline-faint">
            <DataRow label="Spin revenue" value={`$${economics.spinRevenueUsd.toFixed(2)}`} mono />
            <DataRow
              label="Expected payout"
              value={
                economics.expectedPayoutUsd === null
                  ? 'Unknown'
                  : `$${economics.expectedPayoutUsd.toFixed(3)}`
              }
              mono
            />
            <DataRow
              label="Payout ratio"
              value={
                economics.payoutRatio === null ? 'Unknown' : formatPercent(economics.payoutRatio, 1)
              }
              mono
            />
            <DataRow
              label="Margin / spin"
              value={economics.marginUsd === null ? 'Unknown' : `$${economics.marginUsd.toFixed(3)}`}
              mono
            />
            <DataRow
              label="Weights sum to"
              value={economics.weightsSumTo.toLocaleString('en-US')}
              mono
            />
            <DataRow label="Total probability" value="100%" mono />
          </dl>
          <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-faint">
            Ceiling {formatPercent(SAFETY.maxPayoutRatio, 0)} of revenue. Prices known for{' '}
            {economics.priceCoverage.known}/{economics.priceCoverage.total} assets.
          </p>
        </div>

        {/* ---------------------------------------------------------------- liability */}
        <div>
          <Label>Inventory coverage</Label>
          <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-faint">
            Worst case for {SAFETY.assumedConcurrentSpins} concurrent spins, in token units.
          </p>
          <dl className="mt-3 divide-y divide-hairline-faint border-y border-hairline-faint">
            {economics.liabilities.map((liability) => (
              <div key={liability.address} className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="label shrink-0 text-ink-faint">{liability.symbol}</dt>
                <dd className="text-right">
                  <span className="block font-mono text-[0.8125rem] text-ink" data-numeric="">
                    {formatUnitsShort(liability.worstCaseTotal)} needed
                  </span>
                  <span
                    className={`block font-mono text-[0.6875rem] ${
                      liability.inventory === null
                        ? 'text-ink-faint'
                        : liability.covered
                          ? 'text-signal-live'
                          : 'text-signal-stop'
                    }`}
                    data-numeric=""
                  >
                    {liability.inventory === null
                      ? 'inventory unknown'
                      : `${formatUnitsShort(liability.inventory)} held · ${liability.runwaySpins ?? 0} spins runway`}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* ----------------------------------------------------------------- findings */}
        <div>
          <Label>Findings</Label>
          {economics.findings.length === 0 ? (
            <p className="mt-3 text-[0.9375rem] text-signal-live">
              No findings. Within every configured limit.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2.5">
              {economics.findings.map((finding) => (
                <li
                  key={`${finding.code}-${finding.message.slice(0, 24)}`}
                  className={`border-l-2 pl-3 ${
                    finding.blocking
                      ? 'border-signal-stop'
                      : finding.level === 'warn'
                        ? 'border-signal-warn'
                        : 'border-hairline-strong'
                  }`}
                >
                  <span className="micro block text-ink-faint">
                    {finding.code}
                    {finding.blocking ? ' · blocking' : ''}
                  </span>
                  <span className="mt-1 block text-[0.8125rem] leading-relaxed text-ink-soft">
                    {finding.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* -------------------------------------------------------------- activation */}
      <footer className="border-t border-hairline bg-paper-deep/40 p-5">
        {blocked ? (
          <div>
            <p className="text-[0.9375rem] leading-relaxed text-signal-stop">
              <strong>Activation blocked.</strong> {economics.blocking.length} finding
              {economics.blocking.length === 1 ? '' : 's'} must be resolved first. This machine
              could pay out more than it takes in, or could accept a spin it cannot cover.
            </p>
            <Button className="mt-4" disabled>
              Confirm activation
            </Button>
          </div>
        ) : confirmed ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-[0.9375rem] text-signal-live">
              Confirmed for activation. Publish the version from the machine admin wallet by
              calling <code className="font-mono">publishVersion</code>.
            </p>
            <Button variant="secondary" size="sm" onClick={onReset}>
              Undo
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-[58ch] text-[0.875rem] leading-relaxed text-ink-muted">
              Total probability {formatPercent(1, 0)} · EV{' '}
              {economics.expectedPayoutUsd === null
                ? 'unknown'
                : `$${economics.expectedPayoutUsd.toFixed(3)}`}{' '}
              · weight {totalWeight(machine).toLocaleString('en-US')}. Confirming records your
              review; publishing is still a wallet transaction the contract role-checks.
            </p>
            <Button onClick={onConfirm}>Confirm activation</Button>
          </div>
        )}
      </footer>
    </article>
  )
}
