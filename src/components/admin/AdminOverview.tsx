'use client'

import {Label, SectionHead, DataRow, Pill} from '../ui/Primitives'
import {resolveMode, MODE_LABEL} from '@/config/mode'
import {MACHINES, LIVE_MACHINES} from '@/config/machines'
import {REWARD_ASSETS, VERIFICATION_META} from '@/config/rewards'
import {useActivity} from '@/hooks/useActivity'
import {formatCount} from '@/lib/format'

/** Operator overview. Every number is live, configured, or explicitly marked unavailable. */
export function AdminOverview() {
  const status = resolveMode()
  const {records, loading, error, simulated} = useActivity({limit: 100})

  const settled = records.filter((r) => r.status === 'settled').length
  const pending = records.filter((r) => r.status === 'pending').length
  const refunded = records.filter((r) => r.status === 'refunded').length

  return (
    <section>
      <SectionHead eyebrow="Overview" title="Current state" />

      <div className="mt-10 grid gap-8 border-y border-hairline py-8 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Mode" value={MODE_LABEL[status.mode]} />
        <Stat label="Machines live" value={`${LIVE_MACHINES.length} / ${MACHINES.length}`} />
        <Stat label="Reward assets" value={formatCount(REWARD_ASSETS.length)} />
        <Stat
          label="Verification block"
          value={Number(VERIFICATION_META.verifiedAtBlock).toLocaleString('en-US')}
        />
      </div>

      <div className="mt-10 grid gap-10 md:grid-cols-2">
        <div>
          <Label>Spin activity</Label>
          {loading ? (
            <p className="mt-4 text-[0.9375rem] text-ink-muted">Reading…</p>
          ) : error ? (
            <p className="mt-4 max-w-[54ch] text-[0.9375rem] leading-relaxed text-signal-stop">
              {error}
            </p>
          ) : (
            <>
              <dl className="mt-4 divide-y divide-hairline-faint border-y border-hairline-faint">
                <DataRow label="Settled" value={String(settled)} mono />
                <DataRow label="Pending" value={String(pending)} mono />
                <DataRow label="Refunded" value={String(refunded)} mono />
              </dl>
              {simulated ? (
                <p className="mt-3 text-[0.8125rem] text-signal-warn">
                  Demo mode: these are local simulations from this browser, not chain state.
                </p>
              ) : null}
              {pending > 0 ? (
                <p className="mt-3 max-w-[54ch] text-[0.8125rem] leading-relaxed text-ink-muted">
                  Pending spins are waiting on a reveal. If any sits past its window, anyone can
                  report the miss — which refunds the player and slashes the operator bond.
                </p>
              ) : null}
            </>
          )}
        </div>

        <div>
          <Label>Configuration health</Label>
          <dl className="mt-4 divide-y divide-hairline-faint border-y border-hairline-faint">
            <DataRow
              label="Contracts"
              value={
                status.kind === 'ready' && status.mode !== 'demo' ? (
                  <Pill tone="live">Configured</Pill>
                ) : status.kind === 'misconfigured' ? (
                  <Pill tone="stop">Missing addresses</Pill>
                ) : (
                  <Pill tone="warn">Demo — none needed</Pill>
                )
              }
            />
            <DataRow
              label="Candidates rejected"
              value={`${VERIFICATION_META.summary.rejected} / ${VERIFICATION_META.summary.candidates}`}
              mono
            />
            <DataRow
              label="Transfer-verified assets"
              value={`${REWARD_ASSETS.filter((a) => a.transferVerified).length} / ${REWARD_ASSETS.length}`}
              mono
            />
          </dl>
          {status.kind === 'misconfigured' ? (
            <p className="mt-3 max-w-[54ch] text-[0.8125rem] leading-relaxed text-signal-stop">
              Missing: {status.missing.join(', ')}. Arcade refuses to offer spins in this state
              rather than silently simulating them.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function Stat({label, value}: {label: string; value: string}) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-2 font-display text-[1.5rem] leading-none text-ink" data-numeric="">
        {value}
      </p>
    </div>
  )
}
