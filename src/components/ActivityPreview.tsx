'use client'

import {ActivityTape} from './ActivityTape'
import {useActivity, useActivityChainId} from '@/hooks/useActivity'
import {Label} from './ui/Primitives'

/**
 * Homepage activity preview.
 *
 * Shows genuine indexed events, the locally-simulated demo tape, or an honest zero state.
 * It never invents rows.
 */
export function ActivityPreview() {
  const {records, loading, error, simulated} = useActivity({limit: 6})
  const chainId = useActivityChainId()

  if (loading) {
    return (
      <div className="border border-hairline bg-paper-raised">
        <div className="flex items-center gap-3 px-6 py-20">
          <span aria-hidden="true" className="h-px w-8 bg-hairline-strong" />
          <Label>Reading the tape…</Label>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-signal-stop/25 bg-signal-stop/4">
        <div className="px-6 py-10">
          <Label className="text-signal-stop">Could not read activity</Label>
          <p className="mt-3 max-w-[60ch] text-[0.9375rem] leading-relaxed text-ink-soft">{error}</p>
          <p className="mt-3 text-[0.8125rem] text-ink-faint">
            This is a read failure, not an empty tape. Nothing is being hidden.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <ActivityTape
        records={records}
        chainId={chainId}
        compact
        emptyTitle="No spins yet."
        emptyBody={
          simulated
            ? 'Demo mode records the spins you run in this browser. Nothing else is shown here, because nothing else has happened.'
            : 'This deployment has settled no spins. Be the first.'
        }
        emptyAction={{href: '/play', label: 'Open the machine'}}
      />
      {simulated && records.length > 0 ? (
        <p className="mt-4 text-[0.8125rem] text-ink-faint">
          Every row above is a local simulation from this browser. No transaction exists.
        </p>
      ) : null}
    </div>
  )
}
