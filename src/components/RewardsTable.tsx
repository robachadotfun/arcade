'use client'

import {useState} from 'react'
import Link from 'next/link'
import {TokenGlyph} from './OrbitMachine'
import {Label, Pill, Modal, DataRow, ExternalLink, Button} from './ui/Primitives'
import {TIER_LABEL, type RewardAsset, type RewardTier} from '@/config/rewards'
import {explorerUrl, ARC_MAINNET_ID} from '@/config/network'
import {resolveMode} from '@/config/mode'
import {formatCount, formatUsdCompact} from '@/lib/format'

const TIER_TONE: Record<RewardTier, 'arc' | 'live' | 'warn' | 'neutral'> = {
  featured: 'arc',
  verified: 'live',
  discovery: 'warn',
  paused: 'neutral',
}

/**
 * The reward registry table, with a detail drawer per asset.
 *
 * Filterable by curation tier. Sorted by liquidity, but the ordering is presentational — no
 * "top token" ranking is baked in anywhere, because Arc launched days ago and any ranking
 * would be stale within a week.
 */
export function RewardsTable({
  assets,
  machinesByAsset,
}: {
  assets: RewardAsset[]
  machinesByAsset: Map<string, string[]>
}) {
  const [filter, setFilter] = useState<RewardTier | 'all'>('all')
  const [selected, setSelected] = useState<RewardAsset | null>(null)
  const status = resolveMode()
  const chainId = status.kind === 'ready' && status.chainId ? status.chainId : ARC_MAINNET_ID

  const visible = assets
    .filter((a) => filter === 'all' || a.tier === filter)
    .sort((a, b) => b.snapshot.liquidityUsd - a.snapshot.liquidityUsd)

  const tiers: Array<RewardTier | 'all'> = ['all', 'featured', 'verified', 'discovery']

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="group" aria-label="Filter by curation tier" className="flex flex-wrap gap-2">
          {tiers.map((tier) => {
            const active = filter === tier
            const count = tier === 'all' ? assets.length : assets.filter((a) => a.tier === tier).length
            return (
              <button
                key={tier}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(tier)}
                className={`flex items-baseline gap-2 border px-3 py-1.5 text-[0.8125rem] transition-colors ${
                  active
                    ? 'border-ink bg-ink text-paper'
                    : 'border-hairline text-ink-muted hover:border-hairline-strong hover:text-ink'
                }`}
              >
                {tier === 'all' ? 'All' : TIER_LABEL[tier]}
                <span className={`font-mono text-[0.6875rem] ${active ? 'text-paper/60' : 'text-ink-faint'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
        <Label>{visible.length} shown</Label>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-left">
          <caption className="sr-only">
            Arcade reward assets with contract, machines, curation tier and market snapshot.
          </caption>
          <thead>
            <tr className="border-y border-hairline">
              <th scope="col" className="label py-3 pr-4 text-ink-faint">
                Asset
              </th>
              <th scope="col" className="label py-3 pr-4 text-ink-faint">
                Contract
              </th>
              <th scope="col" className="label py-3 pr-4 text-ink-faint">
                Machines
              </th>
              <th scope="col" className="label py-3 pr-4 text-ink-faint">
                Status
              </th>
              <th scope="col" className="label py-3 pr-4 text-right text-ink-faint">
                Liquidity
              </th>
              <th scope="col" className="label py-3 pr-4 text-right text-ink-faint">
                24h volume
              </th>
              <th scope="col" className="label py-3 text-right text-ink-faint">
                Holders
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((asset) => {
              const machines = machinesByAsset.get(asset.address.toLowerCase()) ?? []
              return (
                <tr
                  key={asset.address}
                  id={asset.symbol.toLowerCase()}
                  className="border-b border-hairline-faint transition-colors hover:bg-paper-deep/40"
                >
                  <td className="py-3.5 pr-4">
                    <button
                      type="button"
                      onClick={() => setSelected(asset)}
                      className="flex items-center gap-3 text-left"
                    >
                      <TokenGlyph asset={asset} size={30} />
                      <span>
                        <span className="block text-[0.9375rem] text-ink">{asset.symbol}</span>
                        <span className="block max-w-[24ch] truncate text-[0.75rem] text-ink-faint">
                          {asset.name}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="py-3.5 pr-4">
                    <ExternalLink href={explorerUrl(chainId, 'token', asset.address)}>
                      <span className="font-mono text-[0.75rem]">
                        {asset.address.slice(0, 8)}…{asset.address.slice(-6)}
                      </span>
                    </ExternalLink>
                    <span className="mt-0.5 block micro text-ink-faint">
                      {asset.decimals} decimals
                    </span>
                  </td>
                  <td className="py-3.5 pr-4">
                    {machines.length ? (
                      <span className="flex flex-wrap gap-1">
                        {machines.map((name) => (
                          <span key={name} className="micro border border-hairline px-1.5 py-0.5 text-ink-muted">
                            {name}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="micro text-ink-faint">Registry only</span>
                    )}
                  </td>
                  <td className="py-3.5 pr-4">
                    <Pill tone={TIER_TONE[asset.tier]}>{TIER_LABEL[asset.tier]}</Pill>
                    {asset.transferVerified ? (
                      <span className="mt-1 block micro text-signal-live">transfer probed</span>
                    ) : (
                      <span className="mt-1 block micro text-signal-warn">transfer unverified</span>
                    )}
                  </td>
                  <td className="py-3.5 pr-4 text-right font-mono text-[0.8125rem] text-ink" data-numeric="">
                    {formatUsdCompact(asset.snapshot.liquidityUsd)}
                  </td>
                  <td className="py-3.5 pr-4 text-right font-mono text-[0.8125rem] text-ink-muted" data-numeric="">
                    {formatUsdCompact(asset.snapshot.volume24hUsd)}
                  </td>
                  <td className="py-3.5 text-right font-mono text-[0.8125rem] text-ink-muted" data-numeric="">
                    {formatCount(asset.snapshot.holders)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ---------------------------------------------------------------- detail drawer */}
      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.symbol}` : ''}
        description={selected?.name}
      >
        {selected ? (
          <div>
            <div className="flex items-center gap-3">
              <TokenGlyph asset={selected} size={44} />
              <div>
                <Pill tone={TIER_TONE[selected.tier]}>{TIER_LABEL[selected.tier]}</Pill>
              </div>
            </div>

            {selected.note ? (
              <p className="mt-5 border-l border-hairline-strong pl-4 text-[0.875rem] leading-relaxed text-ink-soft">
                {selected.note}
              </p>
            ) : null}

            <dl className="mt-6 divide-y divide-hairline-faint border-y border-hairline-faint">
              <DataRow label="Contract" value={selected.address} mono />
              <DataRow label="Decimals" value={String(selected.decimals)} mono />
              <DataRow
                label="Transfer probe"
                value={
                  selected.transferVerified
                    ? 'Full amount arrived, returned true'
                    : 'Unverified — not awardable'
                }
              />
              <DataRow
                label="Machines"
                value={
                  (machinesByAsset.get(selected.address.toLowerCase()) ?? []).join(', ') ||
                  'Registry only'
                }
              />
              <DataRow
                label="Liquidity"
                value={formatUsdCompact(selected.snapshot.liquidityUsd)}
                mono
              />
              <DataRow
                label="24h volume"
                value={formatUsdCompact(selected.snapshot.volume24hUsd)}
                mono
              />
              <DataRow label="Holders" value={formatCount(selected.snapshot.holders)} mono />
              <DataRow label="Age at check" value={`${selected.snapshot.ageDays} days`} />
            </dl>

            <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-faint">
              Market figures are a snapshot from {selected.snapshot.source} captured{' '}
              {selected.snapshot.capturedAt}. They are context, not live data, and are never used
              in payout or solvency maths.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setSelected(null)}>
                Close
              </Button>
              <a
                href={explorerUrl(chainId, 'token', selected.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center rounded-[var(--radius-edge)] px-5 text-[0.9375rem] text-arc underline decoration-arc/25 underline-offset-[3px] hover:decoration-arc"
              >
                Arc explorer ↗
              </a>
              <Link
                href="/machines"
                className="inline-flex h-11 items-center px-2 text-[0.9375rem] text-ink-muted hover:text-ink"
              >
                Machines
              </Link>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
