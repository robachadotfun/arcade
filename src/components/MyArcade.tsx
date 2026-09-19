'use client'

import {useConnection, useReadContracts} from 'wagmi'
import {prizeVaultAbi, arcadeMachineManagerAbi} from '@/abi'
import {ActivityTape} from './ActivityTape'
import {TokenGlyph} from './OrbitMachine'
import {ClaimPanel} from './ClaimPanel'
import {SectionHead, Label, ButtonLink, DataRow} from './ui/Primitives'
import {WalletButton} from './WalletButton'
import {ArcadeArt} from './ArcadeArt'
import {useActivity, useActivityChainId} from '@/hooks/useActivity'
import {resolveMode} from '@/config/mode'
import {REWARD_ASSETS} from '@/config/rewards'
import {formatDecimalAmount, formatUsdc} from '@/lib/format'

/**
 * The connected-wallet view.
 *
 * Deliberately does **not** compute profit and loss. Doing that honestly would require
 * reliable prices for thin, volatile Arc assets at both the moment of the spin and now, and
 * that data does not exist at a quality worth acting on. Showing a confident P&L built on
 * bad prices would be the single most misleading number this page could display, so the page
 * shows what you won in token units and leaves valuation to you.
 */
export function MyArcade() {
  const status = resolveMode()
  const {address, isConnected} = useConnection()
  const {records, loading} = useActivity({limit: 100, player: address})
  const chainId = useActivityChainId()

  const contracts = status.kind === 'ready' ? status.contracts : null
  // Primitives, so every memo dependency below is a statically checkable value rather than
  // an object rebuilt on each render.
  const vaultAddress = contracts?.prizeVault
  const managerAddress = contracts?.machineManager
  const canRead = Boolean(vaultAddress) && Boolean(address)

  // Claimable balances across every registered reward asset, plus any native refund owed.
  // Not wrapped in useMemo: the React Compiler memoises this, and a hand-written dependency
  // list here only disagreed with the inferred one and disabled that optimisation.
  const claimQueries = buildClaimQueries()

  function buildClaimQueries() {
    if (!canRead || !vaultAddress || !managerAddress || !address) return []
    return [
      ...REWARD_ASSETS.map(
        (asset) =>
          ({
            address: vaultAddress,
            abi: prizeVaultAbi,
            functionName: 'claimable',
            args: [address, asset.address],
          }) as const,
      ),
      {
        address: managerAddress,
        abi: arcadeMachineManagerAbi,
        functionName: 'refundable',
        args: [address],
      } as const,
    ]
  }

  const {data: claimData, refetch} = useReadContracts({
    contracts: claimQueries,
    query: {enabled: claimQueries.length > 0, refetchInterval: 30_000},
  })

  const claimable = !claimData
    ? []
    : REWARD_ASSETS.map((asset, i) => {
        const result = claimData[i]
        const value = result?.status === 'success' ? (result.result as bigint) : 0n
        return {asset, amount: value}
      }).filter((entry) => entry.amount > 0n)

  const lastResult = claimData?.[claimData.length - 1]
  const refundable = lastResult?.status === 'success' ? (lastResult.result as bigint) : 0n

  const myRecords = records.filter(
    (r) => address && String(r.player).toLowerCase() === address.toLowerCase(),
  )

  const settled = myRecords.filter((r) => r.status === 'settled')

  // Distinct assets won, in token units. No valuation.
  const won = totalsByAsset()

  function totalsByAsset() {
    const totals = new Map<string, {symbol: string; amount: number; address?: string}>()
    for (const record of settled) {
      if (!record.rewardSymbol || !record.rewardAmount) continue
      const key = record.rewardSymbol
      const existing = totals.get(key)
      const amount = Number.parseFloat(record.rewardAmount)
      totals.set(key, {
        symbol: key,
        amount: (existing?.amount ?? 0) + (Number.isFinite(amount) ? amount : 0),
        address: record.rewardAddress ?? existing?.address,
      })
    }
    return [...totals.values()].sort((a, b) => b.amount - a.amount)
  }

  // ------------------------------------------------------------------ zero states
  if (!isConnected) {
    return (
      <div className="shell py-14 md:py-20">
        <SectionHead
          eyebrow="My Arcade"
          title={
            <>
              Your wallet.
              <br />
              Your rewards.
            </>
          }
        />
        <div className="mt-12 max-w-[34rem] border border-hairline bg-paper-raised p-8">
          <ArcadeArt name="empty-wallet" sizes="34rem" className="mx-auto max-w-[18rem]" />
          <h2 className="mt-6 font-display text-[1.5rem] leading-snug text-ink">
            Connect a wallet to see your spins.
          </h2>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">
            Arcade reads your history from Arc. Nothing is stored on a server.
          </p>
          <div className="mt-6">
            <WalletButton />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative iso-grid">
      <div className="shell relative py-14 md:py-20">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <SectionHead
          eyebrow="My Arcade"
          title={
            <>
              Your wallet.
              <br />
              Your rewards.
            </>
          }
        />
      </div>

      {/* ==================================================================== summary */}
      <div className="mt-14 grid gap-8 border-y border-hairline py-8 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total spins" value={String(myRecords.length)} />
        <Stat label="Rewards received" value={String(settled.length)} />
        <Stat
          label="Unclaimed rewards"
          value={String(claimable.length)}
          note={claimable.length ? 'Pull them below' : 'Nothing waiting'}
        />
        <Stat
          label="Refundable"
          value={`${formatUsdc(refundable)} USDC`}
          note={refundable > 0n ? 'From an abandoned spin' : 'None owed'}
        />
      </div>

      {/* ==================================================================== claims */}
      <section className="mt-16">
        <SectionHead eyebrow="Claims" title="Anything still waiting for you." />
        <div className="mt-8">
          <ClaimPanel claimable={claimable} refundable={refundable} onClaimed={() => void refetch()} />
        </div>
      </section>

      {/* ================================================================ assets won */}
      <section className="mt-16">
        <Label>Assets won</Label>
        {won.length === 0 ? (
          <p className="mt-4 max-w-[52ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            Nothing yet.{' '}
            <ButtonLink href="/play" variant="ghost" size="sm" className="px-0 underline">
              Open a machine
            </ButtonLink>
          </p>
        ) : (
          <>
            <ul className="mt-5 divide-y divide-hairline-faint border-y border-hairline-faint">
              {won.map((entry) => {
                const asset = REWARD_ASSETS.find((a) => a.symbol === entry.symbol)
                return (
                  <li key={entry.symbol} className="flex items-center gap-3 py-3.5">
                    {asset ? <TokenGlyph asset={asset} size={28} /> : null}
                    <span className="flex-1">
                      <span className="block text-[0.9375rem] text-ink">{entry.symbol}</span>
                      <span className="block text-[0.75rem] text-ink-faint">
                        {asset?.name ?? 'Unknown asset'}
                      </span>
                    </span>
                    <span className="font-mono text-[0.9375rem] text-ink" data-numeric="">
                      {formatDecimalAmount(entry.amount)}
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="mt-4 max-w-[68ch] text-[0.8125rem] leading-relaxed text-ink-faint">
              Shown in token units, not dollars. Arcade does not compute profit and loss: doing it
              honestly would need trustworthy prices for thin, volatile assets at two points in
              time, and a confident number built on unreliable prices would mislead more than it
              informs.
            </p>
          </>
        )}
      </section>

      {/* ================================================================== activity */}
      <section className="mt-16">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <Label>Recent activity</Label>
          <ButtonLink href="/activity" variant="ghost" size="sm">
            Full tape
          </ButtonLink>
        </div>
        <div className="mt-6">
          {loading ? (
            <div className="border border-hairline bg-paper-raised px-6 py-16">
              <Label>Reading your history…</Label>
            </div>
          ) : (
            <ActivityTape
              records={myRecords.slice(0, 20)}
              chainId={chainId}
              emptyTitle="No spins yet."
              emptyBody="Your spins will appear here as they settle."
              emptyAction={{href: '/play', label: 'Open the machine'}}
            />
          )}
        </div>
      </section>

      {status.kind === 'ready' && contracts ? (
        <section className="mt-16 border-t border-hairline pt-8">
          <Label>Reading from</Label>
          <dl className="mt-4 max-w-[38rem] divide-y divide-hairline-faint border-y border-hairline-faint">
            <DataRow label="Prize vault" value={contracts.prizeVault} mono />
            <DataRow label="Machine manager" value={contracts.machineManager} mono />
          </dl>
        </section>
      ) : null}
      </div>
    </div>
  )
}

function Stat({label, value, note}: {label: string; value: string; note?: string}) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-2 font-display text-[1.75rem] leading-none text-ink" data-numeric="">
        {value}
      </p>
      {note ? <p className="mt-2 text-[0.75rem] text-ink-faint">{note}</p> : null}
    </div>
  )
}
