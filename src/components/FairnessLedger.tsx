'use client'

import {Label, Pill, ExternalLink, DataRow} from './ui/Primitives'
import {useActivity, useActivityChainId} from '@/hooks/useActivity'
import {explorerUrl} from '@/config/network'
import {relativeTime, shortAddress, formatDecimalAmount, formatBlock} from '@/lib/format'
import {resolveMode} from '@/config/mode'

/**
 * Per-spin proof records.
 *
 * Shows every field needed to verify a spin independently: spin id, wallet, machine and
 * version, amount paid, request and settlement transactions, the randomness reference, the
 * resulting reward, block and status.
 *
 * Fields that genuinely are not available are shown as unavailable. Nothing is filled in
 * with a plausible-looking placeholder, because a fake proof is worse than a missing one.
 */
export function FairnessLedger() {
  const {records, loading, error, simulated} = useActivity({limit: 20})
  const chainId = useActivityChainId()
  const status = resolveMode()

  if (loading) {
    return (
      <div className="border border-hairline bg-paper-raised px-6 py-16">
        <Label>Reading the ledger…</Label>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-signal-stop/25 bg-signal-stop/4 px-6 py-10">
        <Label className="text-signal-stop">Could not read the ledger</Label>
        <p className="mt-3 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-soft">{error}</p>
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="border border-hairline bg-paper-raised">
        <div className="flex flex-col items-center gap-5 px-6 py-20 text-center">
          <svg viewBox="0 0 120 120" className="size-24" fill="none" aria-hidden="true">
            <circle cx="60" cy="60" r="44" stroke="var(--color-hairline)" strokeWidth="1" />
            <circle cx="60" cy="60" r="28" stroke="var(--color-hairline-faint)" strokeWidth="1" />
            <rect x="46" y="46" width="28" height="22" stroke="var(--color-hairline-strong)" strokeWidth="1" />
            <path d="M46 52h28" stroke="var(--color-hairline)" strokeWidth="1" />
          </svg>
          <div>
            <p className="font-display text-[1.375rem] leading-tight text-ink">
              No spins to verify yet.
            </p>
            <p className="mt-2 max-w-[44ch] text-[0.9375rem] leading-relaxed text-ink-muted">
              {simulated
                ? 'Demo mode has no onchain proofs to show — a simulated spin has nothing to verify, and pretending otherwise would defeat the point of this page.'
                : 'Once a spin settles, its full proof record appears here.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-px bg-hairline">
      {records.map((record) => (
        <article
          key={record.spinId}
          id={`spin-${record.spinId}`}
          className="bg-paper-raised p-5 md:p-6"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-3">
              <h3 className="font-mono text-[1rem] text-ink" data-numeric="">
                {record.simulated ? record.spinId : `Spin #${record.spinId}`}
              </h3>
              <span className="text-[0.875rem] text-ink-muted">{record.machineName}</span>
              <span className="micro text-ink-faint">v{record.machineVersion}</span>
            </div>
            <div className="flex items-center gap-2">
              {record.simulated ? (
                <Pill tone="warn">Simulated — no proof exists</Pill>
              ) : (
                <Pill tone="live">Onchain</Pill>
              )}
              <span className="micro text-ink-faint">{relativeTime(record.timestamp)}</span>
            </div>
          </div>

          <dl className="mt-4 grid gap-x-10 md:grid-cols-2">
            <div className="divide-y divide-hairline-faint border-y border-hairline-faint">
              <DataRow label="Wallet" value={record.simulated ? 'you (demo)' : shortAddress(record.player)} mono />
              <DataRow label="Amount paid" value={`${record.pricePaid} USDC`} />
              <DataRow
                label="Reward"
                value={
                  record.rewardSymbol && record.rewardAmount
                    ? `${formatDecimalAmount(Number.parseFloat(record.rewardAmount))} ${record.rewardSymbol}`
                    : 'Pending'
                }
              />
              <DataRow label="Rarity" value={record.rarity ?? 'Pending'} />
              <DataRow label="Status" value={record.status} />
            </div>

            <div className="divide-y divide-hairline-faint border-y border-hairline-faint md:border-t-0 md:border-b">
              <DataRow
                label="Block"
                value={record.blockNumber ? formatBlock(record.blockNumber) : 'Unavailable'}
                mono
              />
              <DataRow
                label="Request tx"
                value={
                  record.requestTx && !record.simulated ? (
                    <ExternalLink href={explorerUrl(chainId, 'tx', record.requestTx)}>
                      <span className="font-mono text-[0.75rem]">{shortAddress(record.requestTx, 10, 8)}</span>
                    </ExternalLink>
                  ) : (
                    <span className="text-ink-faint">{record.simulated ? 'none' : 'Unavailable'}</span>
                  )
                }
              />
              <DataRow
                label="Settlement tx"
                value={
                  record.settlementTx && !record.simulated ? (
                    <ExternalLink href={explorerUrl(chainId, 'tx', record.settlementTx)}>
                      <span className="font-mono text-[0.75rem]">
                        {shortAddress(record.settlementTx, 10, 8)}
                      </span>
                    </ExternalLink>
                  ) : (
                    <span className="text-ink-faint">{record.simulated ? 'none' : 'Pending'}</span>
                  )
                }
              />
              <DataRow
                label="Random word"
                value={
                  record.randomWord ? (
                    <span className="font-mono text-[0.6875rem] break-all">{record.randomWord}</span>
                  ) : (
                    <span className="text-ink-faint">{record.simulated ? 'none' : 'Not revealed'}</span>
                  )
                }
              />
              <DataRow
                label="Config hash"
                value={
                  record.configHash ? (
                    <span className="font-mono text-[0.6875rem] break-all">{record.configHash}</span>
                  ) : (
                    <span className="text-ink-faint">See machine page</span>
                  )
                }
              />
            </div>
          </dl>

          {record.simulated ? (
            <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-faint">
              This row is a local simulation. There is no transaction, no commitment and no random
              word to verify — which is exactly why it is labelled rather than dressed up.
            </p>
          ) : null}
        </article>
      ))}

      {status.mode !== 'demo' ? (
        <div className="bg-paper-deep/60 p-5">
          <p className="max-w-[72ch] text-[0.8125rem] leading-relaxed text-ink-muted">
            To verify a spin yourself: read the request from the randomness contract to get its
            commitment index, entropy and anchor block; read the revealed seed and salt at that
            index; then call{' '}
            <code className="font-mono">recompute(seed, salt, entropy, blockhash)</code> and
            compare it with the stored word. The contract&apos;s own answer and your own
            computation must agree.
          </p>
        </div>
      ) : null}
    </div>
  )
}
