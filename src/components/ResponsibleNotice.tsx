'use client'

import {useState} from 'react'
import Link from 'next/link'
import {Button, Label} from './ui/Primitives'
import {COMPLIANCE, COMPLIANCE_KEYS} from '@/config/compliance'
import {useLocalStorageValue, safeSetItem} from '@/hooks/useClientState'

/**
 * Module-scope so the storage snapshot is referentially stable.
 *
 * A null raw value means "not acknowledged", which is also what a blocked-storage read
 * returns — the safe direction, since it shows the notice rather than assuming consent.
 */
function parseAcknowledged(raw: string | null): boolean {
  return raw === 'true'
}

/**
 * The entry acknowledgement.
 *
 * Shown once per browser before play. It states plainly what Arcade is — paying for a
 * randomised outcome — because the one thing this interface must never do is obscure that.
 * There is no mode in which this is skipped, because there is no mode in which a spin is
 * free.
 *
 * Age is self-attested. That is a real limitation and it is labelled as one rather than
 * dressed up as verification.
 */
export function ResponsibleNotice() {
  const [confirmed, setConfirmed] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Derived, not stored in an effect: the server renders "acknowledged" so the notice never
  // flashes on a return visit before hydration.
  const acknowledged = useLocalStorageValue(COMPLIANCE_KEYS.acknowledged, parseAcknowledged, true)
  const needsAck = !acknowledged && !dismissed

  function acknowledge() {
    // If storage is unavailable the notice reappears next visit, which is the safe direction.
    safeSetItem(COMPLIANCE_KEYS.acknowledged, 'true')
    setDismissed(true)
  }

  if (!needsAck) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="responsible-title"
      className="fixed inset-0 z-90 flex items-end justify-center bg-ink/25 backdrop-blur-[2px] sm:items-center"
    >
      <div className="w-full max-w-lg border border-hairline-strong bg-paper-raised p-6 sm:p-8">
        <Label>Before you play</Label>
        <h2 id="responsible-title" className="mt-4 font-display text-[1.75rem] leading-tight text-ink">
          You are paying for a randomised outcome.
        </h2>

        <ul className="mt-6 flex flex-col gap-3 text-[0.9375rem] leading-relaxed text-ink-soft">
          <li className="flex gap-3">
            <span aria-hidden="true" className="mt-2.5 h-px w-4 shrink-0 bg-hairline-strong" />
            <span>
              Each spin costs USDC and returns one token chosen at random from the machine&apos;s
              published table. The reward may be worth less than the spin — sometimes much less.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden="true" className="mt-2.5 h-px w-4 shrink-0 bg-hairline-strong" />
            <span>
              Odds are published before you spin and the outcome is decided onchain, not by this
              interface. You can verify any spin afterwards.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden="true" className="mt-2.5 h-px w-4 shrink-0 bg-hairline-strong" />
            <span>
              Paid randomised prizes are regulated differently in different places. It is your
              responsibility to know whether you may use this where you are.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden="true" className="mt-2.5 h-px w-4 shrink-0 bg-hairline-strong" />
            <span>
              Arcade is independent. It is not affiliated with or endorsed by Circle or Arc.
            </span>
          </li>
        </ul>

        <label className="mt-7 flex cursor-pointer items-start gap-3 border border-hairline bg-paper p-4">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-arc)]"
          />
          <span className="text-[0.875rem] leading-relaxed text-ink-soft">
            I am at least {COMPLIANCE.minimumAge}, I understand I am buying a randomised outcome,
            and I am allowed to use this where I live.
          </span>
        </label>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button onClick={acknowledge} disabled={!confirmed} className="flex-1">
            Enter Arcade
          </Button>
          <Button variant="secondary" onClick={() => window.history.back()}>
            Leave
          </Button>
        </div>

        <p className="mt-5 text-[0.75rem] leading-relaxed text-ink-faint">
          Age is self-attested; Arcade does not verify identity.{' '}
          <Link href="/legal/risk" className="text-arc underline underline-offset-2">
            Risk disclosure
          </Link>{' '}
          ·{' '}
          <Link href="/legal/responsible-play" className="text-arc underline underline-offset-2">
            Responsible play
          </Link>
        </p>
      </div>
    </div>
  )
}
