'use client'

import Link from 'next/link'
import {useActivity, useActivityChainId} from '@/hooks/useActivity'
import {RARITY_ORDER} from '@/config/machines'
import {explorerUrl} from '@/config/network'
import {shortAddress, formatDecimalAmount} from '@/lib/format'
import {Label, SectionHead, Pill, ExternalLink} from './ui/Primitives'

/**
 * The rarest wins Arcade can currently see.
 *
 * ## Why this ranks by rarity and not by value
 *
 * "Biggest win" wants a dollar figure, and Arcade cannot honestly produce one. Rewards are
 * paid in eight different tokens, so ranking by raw amount would put 80,000 ARCADE above 300
 * ARGUS purely because one token has more zeroes. Converting to USD needs prices, and the only
 * prices this repository holds are an operator snapshot captured by hand for solvency
 * arithmetic — stale by construction and never meant to be shown to a player as the worth of
 * their prize.
 *
 * Rarity is the ranking the product already publishes odds against, it is decided onchain by
 * the machine's own table, and it needs no oracle. So the board is ordered by rarity tier,
 * then by recency. A jackpot is genuinely the rarest thing that happened, and that claim
 * survives someone checking it.
 *
 * ## What it can and cannot see
 *
 * It reads the same bounded log window as the activity tape — roughly the last four hours of
 * Arc blocks, not all of history. So this is "the rarest wins recently", and the copy says so
 * rather than implying an all-time record it has no way to establish. A real indexer behind
 * `ActivitySource` is what turns this into an all-time board.
 */
export function Leaderboard({limit = 8, className = ''}: {limit?: number; className?: string}) {
  // Over-fetch: the rarest rows are a small fraction of recent activity, so ranking a larger
  // window gives the board something to actually rank.
  const {records, loading, error} = useActivity({limit: 60})
  const chainId = useActivityChainId()

  const ranked = records
    .filter((r) => r.status === 'settled' && r.rewardSymbol && r.rarity)
    .sort((a, b) => {
      const byRarity =
        RARITY_ORDER.indexOf(b.rarity as never) - RARITY_ORDER.indexOf(a.rarity as never)
      return byRarity !== 0 ? byRarity : b.timestamp - a.timestamp
    })
    .slice(0, limit)

  return (
    <section className={className}>
      <SectionHead eyebrow="Leaderboard" title="The rarest wins right now." />

      <p className="mt-6 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
        Ordered by the rarity tier the machine actually rolled, not by token amount — eight
        different rewards means the biggest number is rarely the biggest prize. Every row links
        to the settlement onchain.
      </p>

      {error ? (
        <p role="alert" className="mt-8 text-[0.9375rem] text-signal-warn">
          Could not read activity. This is an RPC failure, not an empty board.
        </p>
      ) : loading ? (
        <p className="mt-8 text-[0.9375rem] text-ink-faint">Reading recent spins…</p>
      ) : ranked.length === 0 ? (
        <p className="mt-8 max-w-[52ch] text-[0.9375rem] leading-relaxed text-ink-faint">
          No settled spins in the window this reads. Nothing has been hidden — there is simply
          nothing to rank yet.
        </p>
      ) : (
        <ol className="mt-8 divide-y divide-hairline-faint border-y border-hairline-faint">
          {ranked.map((r, i) => (
            <li
              key={r.spinId}
              className="flex items-center gap-4 py-3.5 transition-colors hover:bg-paper-deep/40"
            >
              <span
                aria-hidden="true"
                className="w-6 shrink-0 font-mono text-[0.8125rem] text-ink-faint"
                data-numeric=""
              >
                {i + 1}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9375rem] text-ink">
                  <span className="font-mono text-[0.8125rem]" data-numeric="">
                    {formatDecimalAmount(Number(r.rewardAmount))}
                  </span>{' '}
                  {r.rewardSymbol}
                </p>
                <p className="mt-0.5 truncate text-[0.75rem] text-ink-faint">
                  <span className="font-mono">{shortAddress(r.player as `0x${string}`)}</span>
                  {' · '}
                  {r.machineName}
                </p>
              </div>

              <Pill tone={r.rarity === 'jackpot' ? 'live' : 'neutral'}>{r.rarity}</Pill>

              {r.settlementTx ? (
                <ExternalLink href={explorerUrl(chainId, 'tx', r.settlementTx)}>
                  <span className="font-mono text-[0.6875rem]">tx</span>
                </ExternalLink>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-6 flex items-center gap-4">
        <Label>Reads the last few hours of blocks</Label>
        <Link
          href="/activity"
          className="text-[0.8125rem] text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          See all activity →
        </Link>
      </div>
    </section>
  )
}
