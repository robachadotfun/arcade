'use client'

import {ActivityTape} from './ActivityTape'
import {useActivity, useActivityChainId} from '@/hooks/useActivity'
import {Label} from './ui/Primitives'

/** Recent spins for a single machine. */
export function MachineActivity({
  machineSlug,
  machineName,
}: {
  machineSlug: string
  machineName: string
}) {
  const {records, loading, error, simulated} = useActivity({limit: 40})
  const chainId = useActivityChainId()
  const forMachine = records.filter((r) => r.machineSlug === machineSlug).slice(0, 10)

  if (loading) {
    return (
      <div className="border border-hairline bg-paper-raised px-6 py-14">
        <Label>Reading the tape…</Label>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-signal-stop/25 bg-signal-stop/4 px-6 py-8">
        <Label className="text-signal-stop">Could not read activity</Label>
        <p className="mt-3 max-w-[60ch] text-[0.9375rem] leading-relaxed text-ink-soft">{error}</p>
      </div>
    )
  }

  return (
    <ActivityTape
      records={forMachine}
      chainId={chainId}
      compact
      emptyTitle={`No ${machineName} spins yet.`}
      emptyBody={
        simulated
          ? 'Demo mode only records spins you run in this browser.'
          : 'Nothing has been settled on this machine. Be the first.'
      }
      emptyAction={{href: `/play?machine=${machineSlug}`, label: 'Open the machine'}}
    />
  )
}
