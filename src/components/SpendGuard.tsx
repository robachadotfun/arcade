'use client'

import {useEffect, useRef, useState} from 'react'
import {Button, Label, Modal} from './ui/Primitives'
import {
  COMPLIANCE,
  COMPLIANCE_KEYS,
  SESSION_WINDOW_MS,
  checkLimits,
  limitMessage,
  type SessionUsage,
} from '@/config/compliance'
import {useIsMounted, useLocalStorageValue, safeGetItem, safeSetItem} from '@/hooks/useClientState'
import type {SpinPhase} from '@/hooks/useSpin'

/**
 * Session limits and self-exclusion.
 *
 * Tracks spend and spin count for this browser, tells the parent when another spin would
 * breach a configured limit, and offers self-exclusion.
 *
 * All state is local. That keeps Arcade free of personal data, and it also means these are
 * advisory guardrails rather than enforceable controls — a trade-off stated in the UI rather
 * than hidden.
 *
 * Usage is read through a storage snapshot rather than copied into component state, so the
 * displayed totals cannot drift from what the limit check actually uses.
 */

/** Module-scope parsers so the storage snapshots stay referentially stable. */
function parseNumber(raw: string | null): number {
  const value = Number.parseFloat(raw ?? '')
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function parseTimestamp(raw: string | null): number {
  const value = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function parseExclusion(raw: string | null): number | null {
  const value = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function SpendGuard({
  spinCostUsdc,
  phase,
  onBlockedChange,
}: {
  spinCostUsdc: number
  phase: SpinPhase
  onBlockedChange: (message: string | null) => void
}) {
  const mounted = useIsMounted()
  const [dialogOpen, setDialogOpen] = useState(false)

  const storedSpend = useLocalStorageValue(COMPLIANCE_KEYS.sessionSpend, parseNumber, 0)
  const storedSpins = useLocalStorageValue(COMPLIANCE_KEYS.sessionSpins, parseNumber, 0)
  const storedStart = useLocalStorageValue(COMPLIANCE_KEYS.sessionStarted, parseTimestamp, 0)
  const excludedUntil = useLocalStorageValue(
    COMPLIANCE_KEYS.selfExcludedUntil,
    parseExclusion,
    null as number | null,
  )

  /**
   * Sampled once per mount via a lazy state initialiser rather than read during render.
   * Reading the clock while rendering would make the component impure — identical props
   * could produce different output — and the session window only needs coarse accuracy.
   */
  const [now] = useState(() => Date.now())

  const sessionExpired = storedStart === 0 || now - storedStart > SESSION_WINDOW_MS
  const usage: SessionUsage = {
    spendUsdc: sessionExpired ? 0 : storedSpend,
    spins: sessionExpired ? 0 : storedSpins,
    startedAt: sessionExpired ? now : storedStart,
  }

  /**
   * Counts a spin once it has actually been paid for, not when the button is pressed.
   *
   * The totals are re-read from storage *inside* the effect rather than taken from the
   * render-scope snapshot. That matters: the effect writes those same keys, and depending on
   * the snapshot it mutates would re-trigger the effect on every write — an infinite loop.
   * The only dependencies are the phase transition and the price.
   */
  const counted = useRef(false)

  useEffect(() => {
    if (phase !== 'awaiting-randomness') {
      // Re-arm for the next spin once this one has resolved.
      counted.current = false
      return
    }
    if (counted.current) return
    counted.current = true

    const storedSpendNow = parseNumber(safeGetItem(COMPLIANCE_KEYS.sessionSpend))
    const storedSpinsNow = parseNumber(safeGetItem(COMPLIANCE_KEYS.sessionSpins))
    const storedStartNow = parseTimestamp(safeGetItem(COMPLIANCE_KEYS.sessionStarted))
    const expired = storedStartNow === 0 || Date.now() - storedStartNow > SESSION_WINDOW_MS

    const baseSpend = expired ? 0 : storedSpendNow
    const baseSpins = expired ? 0 : storedSpinsNow
    const baseStart = expired ? Date.now() : storedStartNow

    safeSetItem(COMPLIANCE_KEYS.sessionSpend, String(baseSpend + spinCostUsdc))
    safeSetItem(COMPLIANCE_KEYS.sessionSpins, String(baseSpins + 1))
    safeSetItem(COMPLIANCE_KEYS.sessionStarted, String(baseStart))
  }, [phase, spinCostUsdc])

  // Report blocking upward so the spin button can be disabled.
  const check = checkLimits(usage, spinCostUsdc, excludedUntil, COMPLIANCE, now)
  const blockedMessage = mounted ? limitMessage(check) : null

  useEffect(() => {
    onBlockedChange(blockedMessage)
  }, [blockedMessage, onBlockedChange])

  function selfExclude() {
    const until = now + COMPLIANCE.selfExclusionDays * 24 * 60 * 60 * 1000
    safeSetItem(COMPLIANCE_KEYS.selfExcludedUntil, String(until))
    setDialogOpen(false)
  }

  if (!mounted) return null

  const spendPct =
    COMPLIANCE.sessionSpendLimitUsdc > 0
      ? Math.min(usage.spendUsdc / COMPLIANCE.sessionSpendLimitUsdc, 1)
      : 0

  return (
    <section className="border border-hairline p-5">
      <div className="flex items-baseline justify-between gap-4">
        <Label>This session</Label>
        {COMPLIANCE.selfExclusionEnabled ? (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="text-[0.75rem] text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Take a break
          </button>
        ) : null}
      </div>

      <dl className="mt-4 flex items-baseline justify-between gap-4">
        <div>
          <dt className="sr-only">Spent this session</dt>
          <dd className="font-mono text-[0.9375rem] text-ink" data-numeric="">
            {usage.spendUsdc.toFixed(2)}
            {COMPLIANCE.sessionSpendLimitUsdc > 0 ? (
              <span className="text-ink-faint"> / {COMPLIANCE.sessionSpendLimitUsdc.toFixed(2)}</span>
            ) : null}
            <span className="ml-1.5 text-[0.75rem] text-ink-faint">USDC</span>
          </dd>
        </div>
        <div className="text-right">
          <dt className="sr-only">Spins this session</dt>
          <dd className="font-mono text-[0.9375rem] text-ink" data-numeric="">
            {usage.spins}
            {COMPLIANCE.sessionSpinLimit > 0 ? (
              <span className="text-ink-faint"> / {COMPLIANCE.sessionSpinLimit}</span>
            ) : null}
            <span className="ml-1.5 text-[0.75rem] text-ink-faint">spins</span>
          </dd>
        </div>
      </dl>

      {COMPLIANCE.sessionSpendLimitUsdc > 0 ? (
        <div
          className="mt-3 h-px w-full bg-hairline"
          role="img"
          aria-label={`${Math.round(spendPct * 100)} percent of the session spend limit used`}
        >
          <div
            className={`h-full ${spendPct > 0.8 ? 'bg-signal-warn' : 'bg-arc'}`}
            style={{width: `${spendPct * 100}%`}}
          />
        </div>
      ) : null}

      {excludedUntil !== null && excludedUntil > now ? (
        <p className="mt-4 text-[0.8125rem] leading-relaxed text-signal-warn">
          Self-excluded until {new Date(excludedUntil).toLocaleDateString()}.
        </p>
      ) : null}

      <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-faint">
        Limits are stored in this browser only. Clearing site data resets them, so treat them
        as a personal guardrail rather than an enforced control.
      </p>

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Take a break"
        description={`Self-exclude for ${COMPLIANCE.selfExclusionDays} days. Arcade will not accept spins from this browser until then.`}
      >
        <p className="text-[0.875rem] leading-relaxed text-ink-muted">
          Any rewards you have already won stay yours and remain claimable. This only stops new
          spins, and only in this browser.
        </p>
        <div className="mt-6 flex gap-3">
          <Button onClick={selfExclude} className="flex-1">
            Self-exclude for {COMPLIANCE.selfExclusionDays} days
          </Button>
          <Button variant="ghost" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </section>
  )
}
