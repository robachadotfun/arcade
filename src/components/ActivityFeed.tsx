'use client'

import {useState} from 'react'
import {useAccount} from 'wagmi'
import {ActivityTape} from './ActivityTape'
import {Label, Pill} from './ui/Primitives'
import {useActivity, useActivityChainId} from '@/hooks/useActivity'
import {MACHINES} from '@/config/machines'

type Filter = 'all' | 'mine' | string

/** The full activity tape, with filters. */
export function ActivityFeed() {
  const [filter, setFilter] = useState<Filter>('all')
  const {address} = useAccount()
  const {records, loading, error} = useActivity({limit: 100})
  const chainId = useActivityChainId()

  const filtered = records.filter((record) => {
    if (filter === 'all') return true
    if (filter === 'mine') {
      return address ? String(record.player).toLowerCase() === address.toLowerCase() : false
    }
    return record.machineSlug === filter
  })

  const filters: Array<{key: Filter; label: string}> = [
    {key: 'all', label: 'All'},
    {key: 'mine', label: 'My spins'},
    ...MACHINES.filter((m) => m.status === 'live').map((m) => ({key: m.slug, label: m.name})),
  ]

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="group" aria-label="Filter activity" className="flex flex-wrap gap-2">
          {filters.map((item) => {
            const active = filter === item.key
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(item.key)}
                className={`border px-3 py-1.5 text-[0.8125rem] transition-colors ${
                  active
                    ? 'border-ink bg-ink text-paper'
                    : 'border-hairline text-ink-muted hover:border-hairline-strong hover:text-ink'
                }`}
              >
                {item.label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-3">
          <Pill tone="live">Live from Arc</Pill>
          <Label>{filtered.length} rows</Label>
        </div>
      </div>

      {filter === 'mine' && !address ? (
        <p className="mt-6 border border-hairline bg-paper-deep/50 p-4 text-[0.9375rem] text-ink-muted">
          Connect a wallet to filter the tape to your own spins.
        </p>
      ) : null}

      {loading ? (
        <div className="mt-6 border border-hairline bg-paper-raised px-6 py-20">
          <Label>Reading the tape…</Label>
        </div>
      ) : error ? (
        <div className="mt-6 border border-signal-stop/25 bg-signal-stop/4 px-6 py-10">
          <Label className="text-signal-stop">Could not read activity</Label>
          <p className="mt-3 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-soft">{error}</p>
          <p className="mt-3 text-[0.8125rem] text-ink-faint">
            This is a read failure, not an empty tape. If you have a spin in flight it is still
            recorded onchain.
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <ActivityTape
            records={filtered}
            chainId={chainId}
            emptyTitle="No spins yet."
            emptyBody="This deployment has settled no spins. Be the first."
            emptyAction={{href: '/play', label: 'Open the machine'}}
          />
        </div>
      )}

      <p className="mt-6 max-w-[70ch] text-[0.8125rem] leading-relaxed text-ink-faint">
        Rows are read from <code className="font-mono">SpinRequested</code> and{' '}
        <code className="font-mono">SpinSettled</code> events over a bounded block range. For a
        high-traffic deployment this should be replaced by a dedicated indexer — the{' '}
        <code className="font-mono">ActivitySource</code> interface exists for exactly that.
      </p>
    </div>
  )
}
