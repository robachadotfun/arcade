'use client'

import Link from 'next/link'
import {Label, Pill, ExternalLink} from './ui/Primitives'
import {STATUS_LABEL, STATUS_TONE, type ActivityRecord} from '@/lib/activity'
import {relativeTime, shortAddress, shortHash, formatDecimalAmount} from '@/lib/format'
import {explorerUrl} from '@/config/network'

/**
 * The activity tape.
 *
 * Reads like a financial tape rather than a generic table: monospaced columns, hairline
 * rules, tabular figures, no zebra striping. Every row is an indexed onchain event; there is
 * no other kind of row this component can render.
 */
export function ActivityTape({
  records,
  chainId,
  emptyTitle = 'No spins yet.',
  emptyBody = 'Be the first.',
  emptyAction,
  compact = false,
}: {
  records: ActivityRecord[]
  chainId: number
  emptyTitle?: string
  emptyBody?: string
  emptyAction?: {href: string; label: string}
  compact?: boolean
}) {
  if (records.length === 0) {
    return (
      <div className="border border-hairline bg-paper-raised">
        <div className="flex flex-col items-center gap-5 px-6 py-20 text-center">
          {/* The zero state gets a real drawing, not a shrug. */}
          <svg viewBox="0 0 120 120" className="size-24" fill="none" aria-hidden="true">
            <circle cx="60" cy="60" r="44" stroke="var(--color-hairline)" strokeWidth="1" />
            <circle cx="60" cy="60" r="30" stroke="var(--color-hairline-faint)" strokeWidth="1" />
            <circle cx="60" cy="60" r="56" stroke="var(--color-hairline-faint)" strokeWidth="1" />
            <circle cx="60" cy="16" r="2.5" fill="var(--color-arc-soft)" />
            <line x1="52" y1="60" x2="68" y2="60" stroke="var(--color-hairline-strong)" strokeWidth="1" />
            <line x1="60" y1="52" x2="60" y2="68" stroke="var(--color-hairline-strong)" strokeWidth="1" />
          </svg>
          <div>
            <p className="font-display text-[1.375rem] leading-tight text-ink">{emptyTitle}</p>
            <p className="mt-2 text-[0.9375rem] text-ink-muted">{emptyBody}</p>
          </div>
          {emptyAction ? (
            <Link
              href={emptyAction.href}
              className="text-[0.9375rem] text-arc underline decoration-arc/25 underline-offset-[3px] hover:decoration-arc"
            >
              {emptyAction.label}
            </Link>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="border border-hairline bg-paper-raised">
      {/* Column headings, hidden on mobile where rows become stacked blocks. */}
      <div
        aria-hidden="true"
        className={`hidden border-b border-hairline px-4 py-2.5 md:grid md:gap-4 ${
          compact
            ? 'md:grid-cols-[5rem_7rem_1fr_7rem]'
            : 'md:grid-cols-[5rem_6.5rem_8rem_1fr_6rem_6rem]'
        }`}
      >
        <Label>Time</Label>
        <Label>Player</Label>
        {!compact ? <Label>Machine</Label> : null}
        <Label>Reward</Label>
        <Label>Status</Label>
        {!compact ? <Label>Tx</Label> : null}
      </div>

      <ul className="divide-y divide-hairline-faint">
        {records.map((record) => (
          <li
            key={record.spinId}
            className={`px-4 py-3.5 md:grid md:items-center md:gap-4 md:py-2.5 ${
              compact
                ? 'md:grid-cols-[5rem_7rem_1fr_7rem]'
                : 'md:grid-cols-[5rem_6.5rem_8rem_1fr_6rem_6rem]'
            }`}
          >
            {/* time */}
            <span className="font-mono text-[0.75rem] text-ink-faint" data-numeric="">
              {relativeTime(record.timestamp)}
            </span>

            {/* player */}
            <span className="font-mono text-[0.75rem] text-ink-muted">
              {shortAddress(record.player)}
            </span>

            {/* machine */}
            {!compact ? (
              <Link
                href={`/machines/${record.machineSlug}`}
                className="text-[0.875rem] text-ink transition-colors hover:text-arc"
              >
                {record.machineName}
                {record.machineVersion !== undefined ? (
                  <span className="ml-1.5 font-mono text-[0.6875rem] text-ink-faint">
                    v{record.machineVersion}
                  </span>
                ) : null}
              </Link>
            ) : null}

            {/* reward */}
            <span className="mt-1.5 flex flex-wrap items-baseline gap-2 md:mt-0">
              {record.status === 'settled' && record.rewardSymbol ? (
                <>
                  <span className="font-mono text-[0.875rem] text-ink" data-numeric="">
                    {record.rewardAmount
                      ? formatDecimalAmount(Number.parseFloat(record.rewardAmount))
                      : '—'}
                  </span>
                  <span className="text-[0.875rem] text-ink-soft">${record.rewardSymbol}</span>
                  {record.rarity ? (
                    <span className="micro text-ink-faint">{record.rarity}</span>
                  ) : null}
                </>
              ) : record.status === 'pending' ? (
                <span className="text-[0.875rem] text-ink-faint">Awaiting randomness</span>
              ) : (
                <span className="text-[0.875rem] text-ink-faint">Refunded {record.pricePaid} USDC</span>
              )}
            </span>

            {/* status */}
            <span className="mt-2 block md:mt-0">
              <Pill tone={STATUS_TONE[record.status]}>{STATUS_LABEL[record.status]}</Pill>
            </span>

            {/* tx */}
            {!compact ? (
              <span className="mt-2 block md:mt-0">
                {record.settlementTx ? (
                  <ExternalLink href={explorerUrl(chainId, 'tx', record.settlementTx)}>
                    <span className="font-mono text-[0.75rem]">{shortHash(record.settlementTx)}</span>
                  </ExternalLink>
                ) : (
                  <span className="font-mono text-[0.75rem] text-ink-faint">—</span>
                )}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
