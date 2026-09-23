'use client'

import {useMemo, useState} from 'react'
import Link from 'next/link'
import {useConnection} from 'wagmi'
import {OrbitMachine, TokenGlyph, type OrbitPhase} from './OrbitMachine'
import {OddsRail, RarityTag} from './OddsRail'
import {Button, ButtonLink, Label, Pill, DataRow, ExternalLink, Dot} from './ui/Primitives'
import {WalletButton} from './WalletButton'
import {SpendGuard} from './SpendGuard'
import {ArcadeArt, MACHINE_ART, RARITY_ART} from './ArcadeArt'
import {
  LIVE_MACHINES,
  MACHINES,
  assetsOnMachine,
  machineBySlug,
  rarityOdds,
  tierOdds,
  type MachineConfig,
} from '@/config/machines'
import {OnchainConfigHash} from './OnchainConfigHash'
import {resolveMode, MODE_DESCRIPTION, MODE_LABEL} from '@/config/mode'
import {explorerUrl, ARC_MAINNET_ID} from '@/config/network'
import {useSpin, type SpinPhase} from '@/hooks/useSpin'
import {formatDecimalAmount, formatPercent, formatUsdc} from '@/lib/format'
import {labelFor} from '@/config/rewards'

/**
 * The /play surface.
 *
 * Structure follows the five spin states: READY, AUTHORIZE, PENDING, SETTLING, REVEAL. The
 * cost is stated in full before the signature, not summarised, and every failure path lands
 * on a named error with a recovery action rather than an endless spinner.
 */
export function PlaySurface({initialSlug}: {initialSlug?: string}) {
  const status = resolveMode()
  const [slug, setSlug] = useState(() => {
    const requested = initialSlug ? machineBySlug(initialSlug) : undefined
    if (requested && requested.status === 'live') return requested.slug
    return LIVE_MACHINES[0]?.slug ?? MACHINES[0]?.slug ?? 'genesis'
  })

  const machine = machineBySlug(slug) ?? LIVE_MACHINES[0]
  if (!machine) {
    return (
      <div className="shell section-y">
        <p className="text-lede text-ink-muted">No machines are configured.</p>
      </div>
    )
  }

  return (
    <div className="relative iso-grid">
      <div className="shell relative py-8 pb-28 md:py-10 lg:pb-14">
      <MachineSwitcher current={machine} onSelect={setSlug} />
      <SpinConsole key={machine.slug} machine={machine} />
      <p className="mt-10 max-w-[68ch] text-[0.8125rem] leading-relaxed text-ink-faint">
        {status.kind === 'ready' ? `${MODE_DESCRIPTION[status.mode]} ` : ''}
        Most spins return less than the spin price. Rewards are not guaranteed to be worth more
        than what you paid.
      </p>
      </div>
    </div>
  )
}

function MachineSwitcher({
  current,
  onSelect,
}: {
  current: MachineConfig
  onSelect: (slug: string) => void
}) {
  return (
    <div className="hairline-b pb-5">
      <Label>Machine</Label>
      <div
        role="tablist"
        aria-label="Choose a machine"
        className="mt-4 flex gap-2 overflow-x-auto pb-1"
      >
        {MACHINES.map((machine) => {
          const active = machine.slug === current.slug
          const disabled = machine.status !== 'live'
          return (
            <button
              key={machine.slug}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={disabled}
              onClick={() => onSelect(machine.slug)}
              className={`flex shrink-0 items-baseline gap-2.5 border px-4 py-2.5 transition-colors ${
                active
                  ? 'border-ink bg-ink text-paper'
                  : disabled
                    ? 'cursor-not-allowed border-hairline-faint text-ink-faint'
                    : 'border-hairline text-ink hover:border-hairline-strong'
              }`}
            >
              <span className="text-[0.9375rem]">{machine.name}</span>
              <span
                className={`font-mono text-[0.75rem] ${active ? 'text-paper/70' : 'text-ink-faint'}`}
                data-numeric=""
              >
                ${machine.spinPriceUsdc}
              </span>
              {disabled ? <span className="micro">{machine.status}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Maps spin phases onto the orbit's visual phases. */
const ORBIT_PHASE: Record<SpinPhase, OrbitPhase> = {
  idle: 'idle',
  'needs-wallet': 'idle',
  'wrong-network': 'idle',
  'insufficient-funds': 'idle',
  blocked: 'idle',
  ready: 'ready',
  authorizing: 'authorizing',
  'pending-tx': 'pending',
  'awaiting-randomness': 'pending',
  settling: 'settling',
  revealed: 'revealed',
  error: 'idle',
}

function SpinConsole({machine}: {machine: MachineConfig}) {
  const status = resolveMode()
  const {isConnected} = useConnection()
  const spin = useSpin(machine)
  const [spendBlocked, setSpendBlocked] = useState<string | null>(null)

  const assets = useMemo(() => assetsOnMachine(machine), [machine])
  const odds = useMemo(() => rarityOdds(machine), [machine])
  const tiers = useMemo(() => tierOdds(machine), [machine])
  const chainId = status.kind === 'ready' && status.chainId ? status.chainId : ARC_MAINNET_ID

  const settledIndex = useMemo(() => {
    if (spin.phase !== 'revealed' || !spin.outcome?.asset) return null
    const index = assets.findIndex(
      (a) => a.address.toLowerCase() === spin.outcome!.asset!.address.toLowerCase(),
    )
    return index === -1 ? null : index
  }, [spin.phase, spin.outcome, assets])

  const busy =
    spin.phase === 'authorizing' ||
    spin.phase === 'pending-tx' ||
    spin.phase === 'awaiting-randomness' ||
    spin.phase === 'settling'

  return (
    <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_0.85fr] lg:gap-14">
      {/* ================================================================== machine */}
      <div>
        {/*
          The machine portrait is a small inline mark beside the title rather than a plate
          above the orbit. Full width it pushed the spinner — the one thing a player comes
          here to use — below the fold on a laptop.
        */}
        <div className="flex items-start gap-4 sm:gap-5">
          <ArcadeArt
            name={MACHINE_ART[machine.slug] ?? 'genesis-machine'}
            className="w-16 shrink-0 sm:w-20"
            sizes="80px"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h1 className="text-title text-ink">{machine.name}</h1>
              <Pill tone="live">
                Config <OnchainConfigHash machine={machine} className="ml-1" />
              </Pill>
            </div>
            <p className="mt-3 max-w-[52ch] text-[1rem] leading-relaxed text-ink-muted">
              {machine.description}
            </p>
          </div>
        </div>

        {/*
          The orbit is sized by the shorter of available width and available *height*, so the
          spinner is always fully in the first viewport. A 13" laptop has ~720px of usable
          height; a fixed 28rem square overflowed it by about 110px and the player had to
          scroll to reach the thing they came for.

          Two reserves because the chrome differs: 25rem on desktop covers the header, the
          machine switcher and this machine's title block; 34rem on phones adds the taller
          stacked title block and the sticky spin bar pinned to the bottom, which would
          otherwise sit on top of the orbit's lower edge.
        */}
        <div className="relative mx-auto mt-6 w-full max-w-[clamp(13rem,calc(100svh-34rem),28rem)] lg:max-w-[clamp(16rem,calc(100svh-25rem),28rem)]">
          <OrbitMachine
            assets={assets}
            phase={ORBIT_PHASE[spin.phase]}
            settledIndex={settledIndex}
            priceLabel={`${machine.spinPriceUsdc} USDC`}
            size="hero"
          />
        </div>

        {/* A live region: the outcome is announced, not only drawn. */}
        <p aria-live="polite" role="status" className="sr-only">
          {spin.phase === 'revealed' && spin.outcome
            ? `Reward found: ${formatDecimalAmount(Number.parseFloat(spin.outcome.amount))} ${spin.outcome.asset ? labelFor(spin.outcome.asset) : 'tokens'}.`
            : busy
              ? 'Spin in progress.'
              : ''}
        </p>
      </div>

      {/* ================================================================== controls */}
      <div className="flex flex-col gap-8">
        <StateCard
          machine={machine}
          spin={spin}
          isConnected={isConnected}
          spendBlocked={spendBlocked}
          onSpin={() => spin.spin()}
          chainId={chainId}
        />

        <SpendGuard
          spinCostUsdc={Number.parseFloat(machine.spinPriceUsdc)}
          phase={spin.phase}
          onBlockedChange={setSpendBlocked}
        />

        <StickySpinBar
          machine={machine}
          phase={spin.phase}
          blocked={Boolean(spendBlocked)}
          onSpin={() => spin.spin()}
          onReset={spin.reset}
        />

        {/* -------------------------------------------------------- published odds */}
        <section>
          <div className="flex items-baseline justify-between gap-4">
            <Label>Published odds</Label>
            <Link
              href={`/machines/${machine.slug}`}
              className="text-[0.8125rem] text-arc underline decoration-arc/25 underline-offset-[3px] hover:decoration-arc"
            >
              Full table
            </Link>
          </div>
          <OddsRail odds={odds} className="mt-4" />

          <ul className="mt-5 grid grid-cols-4 gap-3">
            {odds.map((band) => (
              <li key={band.rarity} className="text-center">
                <ArcadeArt
                  name={RARITY_ART[band.rarity] ?? 'rarity-common'}
                  sizes="(min-width: 1024px) 7rem, 20vw"
                />
                <span className="micro mt-2 block text-ink-faint">{band.rarity}</span>
              </li>
            ))}
          </ul>

          <ul className="mt-6 divide-y divide-hairline-faint border-y border-hairline-faint">
            {tiers.map(({tier, asset, probability}, i) => (
              <li key={`${tier.token}-${tier.rarity}-${i}`} className="flex items-center gap-3 py-2.5">
                {asset ? <TokenGlyph asset={asset} size={22} /> : null}
                <span className="flex-1 truncate text-[0.875rem] text-ink">
                  {asset?.symbol ?? 'Unknown'}
                </span>
                <RarityTag rarity={tier.rarity} />
                <span className="w-14 text-right font-mono text-[0.8125rem] text-ink" data-numeric="">
                  {formatPercent(probability)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

/**
 * The mobile action bar.
 *
 * On a phone the state card sits below the machine, so the primary action would otherwise be
 * off-screen while the orbit is in view. This pins it to the bottom within thumb reach and
 * doubles as a status line during a spin — the cost stays visible right up to the signature.
 *
 * Hidden on desktop, where the state card is already beside the machine.
 */
function StickySpinBar({
  machine,
  phase,
  blocked,
  onSpin,
  onReset,
}: {
  machine: MachineConfig
  phase: SpinPhase
  blocked: boolean
  onSpin: () => void
  onReset: () => void
}) {
  // Nothing useful to offer in these states; the state card explains them in full.
  if (phase === 'blocked' || phase === 'error' || phase === 'needs-wallet' || phase === 'wrong-network') {
    return null
  }

  const busy =
    phase === 'authorizing' ||
    phase === 'pending-tx' ||
    phase === 'awaiting-randomness' ||
    phase === 'settling'

  const label: Record<string, string> = {
    authorizing: 'Confirm in your wallet',
    'pending-tx': 'Settling on Arc…',
    'awaiting-randomness': 'Waiting for the reveal…',
    settling: 'Resolving your reward…',
  }

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-paper/95 backdrop-blur-md lg:hidden"
      style={{paddingBottom: 'env(safe-area-inset-bottom)'}}
    >
      <div className="shell flex items-center gap-4 py-3">
        {busy ? (
          <p className="flex flex-1 items-center gap-2.5 text-[0.875rem] text-ink-soft">
            <Dot tone="arc" pulse />
            {label[phase] ?? 'Working…'}
          </p>
        ) : phase === 'revealed' ? (
          <Button className="flex-1" onClick={onReset}>
            Spin again
          </Button>
        ) : (
          // One full-width control carrying the price. At 375px a separate price block and a
          // button crowd each other, and the cost must stay unmistakable.
          <Button className="flex-1" size="lg" onClick={onSpin} disabled={blocked}>
            Insert {machine.spinPriceUsdc}.00 USDC
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * The state card: exactly one of the spin states, always with a clear cost and a clear next
 * action.
 */
function StateCard({
  machine,
  spin,
  isConnected,
  spendBlocked,
  onSpin,
  chainId,
}: {
  machine: MachineConfig
  spin: ReturnType<typeof useSpin>
  isConnected: boolean
  spendBlocked: string | null
  onSpin: () => void
  chainId: number
}) {
  const status = resolveMode()
  const {phase, outcome, error} = spin

  // ---------------------------------------------------------------- error states
  if (phase === 'blocked' || phase === 'error') {
    return (
      <div className="border border-signal-stop/25 bg-signal-stop/4 p-6">
        <div className="flex items-center gap-2">
          <Dot tone="stop" />
          <Label className="text-signal-stop">{error?.code ?? 'Unavailable'}</Label>
        </div>
        <h2 className="mt-4 font-display text-[1.375rem] leading-snug text-ink">
          {error?.title ?? 'This machine is unavailable'}
        </h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-soft">{error?.detail}</p>
        <p className="mt-4 border-t border-signal-stop/15 pt-4 text-[0.875rem] leading-relaxed text-ink-soft">
          <span className="label mr-2 text-signal-stop">What to do</span>
          {error?.recovery}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {error?.retryable ? (
            <Button onClick={spin.reset}>Try again</Button>
          ) : (
            <ButtonLink href="/machines" variant="secondary">
              Browse machines
            </ButtonLink>
          )}
          <ButtonLink href="/activity" variant="ghost">
            Check the tape
          </ButtonLink>
        </div>
      </div>
    )
  }

  // --------------------------------------------------------------- needs a wallet
  if (phase === 'needs-wallet') {
    return (
      <div className="border border-hairline bg-paper-raised p-6">
        <Label>Step 01</Label>
        <h2 className="mt-4 font-display text-[1.75rem] leading-tight text-ink">
          Connect wallet
          <br />
          to enter Arcade.
        </h2>
        <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-muted">
          Arcade never sees your keys. You approve every transaction in your own wallet.
        </p>
        <div className="mt-6">
          <WalletButton />
        </div>
      </div>
    )
  }

  if (phase === 'wrong-network') {
    return (
      <div className="border border-signal-warn/30 bg-signal-warn/4 p-6">
        <Label className="text-signal-warn">Wrong network</Label>
        <h2 className="mt-4 font-display text-[1.5rem] leading-snug text-ink">
          Switch to Arc to continue.
        </h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-soft">
          Your wallet is connected to a different chain. Arcade only settles on Arc.
        </p>
        <div className="mt-6">
          <WalletButton />
        </div>
      </div>
    )
  }

  if (phase === 'insufficient-funds') {
    return (
      <div className="border border-signal-warn/30 bg-signal-warn/4 p-6">
        <Label className="text-signal-warn">Insufficient USDC</Label>
        <h2 className="mt-4 font-display text-[1.5rem] leading-snug text-ink">
          Not enough to cover this spin.
        </h2>
        <dl className="mt-5 divide-y divide-hairline-faint border-y border-hairline-faint">
          <DataRow label="Spin price" value={`${machine.spinPriceUsdc} USDC`} />
          <DataRow
            label="Your balance"
            value={spin.balance !== undefined ? `${formatUsdc(spin.balance)} USDC` : '—'}
            mono
          />
        </dl>
        <p className="mt-4 text-[0.875rem] leading-relaxed text-ink-soft">
          You also need a little extra for gas, which on Arc is paid in the same USDC.
        </p>
      </div>
    )
  }

  // ------------------------------------------------------------------- in progress
  if (phase === 'authorizing' || phase === 'pending-tx' || phase === 'awaiting-randomness' || phase === 'settling') {
    const copy: Record<string, {label: string; title: string; detail: string}> = {
      authorizing: {
        label: 'Step 03 — confirm',
        title: `You're spending ${machine.spinPriceUsdc}.00 USDC for one ${machine.name} spin.`,
        detail: 'Approve the transaction in your wallet. Nothing is charged until you do.',
      },
      'pending-tx': {
        label: 'Transaction pending',
        title: 'Your payment is settling on Arc.',
        detail: 'Arc settles sub-second. This usually takes a moment.',
      },
      'awaiting-randomness': {
        label: 'Randomness',
        title: 'Waiting for the reveal.',
        detail:
          'Your spin is recorded and its price is locked. The outcome is already determined by a commitment published before you spun — waiting cannot change it.',
      },
      settling: {
        label: 'Settling',
        title: 'Resolving your reward.',
        detail: 'Reading the revealed word and reserving your reward in the vault.',
      },
    }
    const c = copy[phase]!

    return (
      <div className="border border-hairline bg-paper-raised p-6">
        <div className="flex items-center gap-2">
          <Dot tone="arc" pulse />
          <Label>{c.label}</Label>
        </div>
        <h2 className="mt-4 font-display text-[1.375rem] leading-snug text-ink">{c.title}</h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">{c.detail}</p>

        {/* A thin progress rail rather than a spinner. */}
        <div className="mt-6 h-px w-full overflow-hidden bg-hairline">
          <div
            className="h-full w-1/3 bg-arc"
            style={{animation: 'arcade-tape 1.6s linear infinite'}}
          />
        </div>

        <dl className="mt-6 divide-y divide-hairline-faint border-y border-hairline-faint">
          <DataRow label="Paying" value={`${machine.spinPriceUsdc}.00 USDC`} />
          {spin.pendingSpinId ? <DataRow label="Spin id" value={`#${spin.pendingSpinId}`} mono /> : null}
          {spin.txHash ? (
            <DataRow
              label="Transaction"
              value={
                <ExternalLink href={explorerUrl(chainId, 'tx', spin.txHash)}>
                  <span className="font-mono text-[0.75rem]">View on explorer</span>
                </ExternalLink>
              }
            />
          ) : null}
        </dl>

        {phase === 'awaiting-randomness' ? (
          <>
            <p className="mt-4 text-[0.8125rem] leading-relaxed text-ink-faint">
              Safe to close this tab. The spin is onchain, and anyone — including you, later —
              can settle it. No further signature is needed.
            </p>
            {/*
              Only after the operator has had long enough. Settlement is permissionless and
              the outcome is already fixed by the revealed word, so this finalises the result
              rather than deciding it — and it is one click, never automatic.
            */}
            {spin.canSettleManually ? (
              <div className="mt-4 border-t border-hairline-faint pt-4">
                <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
                  This is taking longer than usual. You can settle it yourself — one
                  transaction, and it cannot change what you won.
                </p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => void spin.settleNow()}>
                  Settle it myself
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    )
  }

  // ---------------------------------------------------------------------- revealed
  if (phase === 'revealed' && outcome) {
    return (
      <div className="relative overflow-hidden border border-arc/25 bg-arc-wash p-6">
        <div className="relative flex items-center justify-between gap-4">
          <Label className="text-arc">You found</Label>
          <Pill tone="live">Settled</Pill>
        </div>

        <p
          className="mt-4 font-display text-display leading-none text-ink"
          data-numeric=""
          style={{animation: 'arcade-rise 700ms var(--ease-settle) both'}}
        >
          {formatDecimalAmount(Number.parseFloat(outcome.amount))}
        </p>
        <p className="mt-2 flex items-center gap-2.5">
          {outcome.asset ? <TokenGlyph asset={outcome.asset} size={24} /> : null}
          <span className="text-lede text-ink-soft">${outcome.asset ? labelFor(outcome.asset) : 'UNKNOWN'}</span>
          <RarityTag rarity={outcome.rarity} />
        </p>

        <dl className="mt-6 divide-y divide-hairline-faint border-y border-hairline-faint">
          <DataRow label="Spin id" value={`#${outcome.spinId}`} mono />
          <DataRow label="Paid" value={`${machine.spinPriceUsdc}.00 USDC`} />
          <DataRow
            label="Delivery"
            value={outcome.delivered ? 'Sent to your wallet' : 'Claimable in My Arcade'}
          />
        </dl>

        {!outcome.delivered ? (
          <p className="mt-4 border border-signal-warn/25 bg-signal-warn/5 p-3 text-[0.8125rem] leading-relaxed text-ink-soft">
            The direct transfer did not go through, so your reward is being held for you and is
            claimable. It stays reserved in the vault and cannot be withdrawn by anyone else.
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={spin.reset}>Spin again</Button>
          {outcome.settlementTx ? (
            <ButtonLink href={explorerUrl(chainId, 'tx', outcome.settlementTx)} variant="secondary">
              View transaction
            </ButtonLink>
          ) : null}
          <ButtonLink href={`/fairness#spin-${outcome.spinId}`} variant="ghost">
            View proof
          </ButtonLink>
        </div>

      </div>
    )
  }

  // ------------------------------------------------------------------------- ready
  return (
    <div className="border border-hairline bg-paper-raised p-6">
      <Label>Ready</Label>

      <dl className="mt-5 divide-y divide-hairline-faint border-y border-hairline-faint">
        <DataRow label="Machine" value={machine.name} />
        <DataRow label="Spin price" value={`${machine.spinPriceUsdc}.00 USDC`} />
        <DataRow label="Network" value={status.kind === 'ready' ? MODE_LABEL[status.mode] : 'Not configured'} />
        {isConnected && spin.balance !== undefined ? (
          <DataRow label="Your balance" value={`${formatUsdc(spin.balance)} USDC`} mono />
        ) : null}
        <DataRow label="Reward assets" value={String(assetsOnMachine(machine).length)} />
      </dl>

      <p className="mt-5 text-[0.875rem] leading-relaxed text-ink-soft">
        You are paying {machine.spinPriceUsdc}.00 USDC for one randomised outcome. The reward may be
        worth less than that.
      </p>

      {spendBlocked ? (
        <p className="mt-5 border border-signal-warn/30 bg-signal-warn/5 p-3 text-[0.875rem] leading-relaxed text-signal-warn">
          {spendBlocked}
        </p>
      ) : null}

      <Button
        size="lg"
        className="mt-6 w-full"
        onClick={onSpin}
        disabled={Boolean(spendBlocked)}
      >
        Insert {machine.spinPriceUsdc} USDC
      </Button>

      <p className="mt-3 text-center text-[0.75rem] text-ink-faint">
        One signature. No approval step.
      </p>
    </div>
  )
}
