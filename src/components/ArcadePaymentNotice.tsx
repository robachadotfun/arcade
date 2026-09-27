import Link from 'next/link'
import {ARCADE_TOKEN} from '@/config/token'
import {Label, Pill} from './ui/Primitives'

/**
 * Announces that spins will be payable in $ARCADE — and is careful not to imply they are.
 *
 * ## Why this is a notice and not a toggle
 *
 * `ArcadeMachineManager` takes payment as `msg.value` and reverts unless it exactly equals the
 * machine's price in native USDC. There is no ERC-20 payment path in the deployed contract and
 * no way to add one: these contracts are not upgradeable, so paying in ARCADE means a new
 * deployment, new roles, and migrating vault inventory to it.
 *
 * That is a real piece of work rather than a setting, which is exactly why this component
 * states a direction instead of dressing up a disabled button. A greyed-out "Pay with ARCADE"
 * control would read as something nearly finished, and someone would ask when it lands. This
 * says what is true: it is planned, it needs a contract, and the price is still USDC today.
 *
 * ## What it deliberately does not say
 *
 * No date, and no discount. Both are easy to write and neither is decided — a promised
 * discount in particular would set the economics of a machine whose solvency is already
 * measured against a 77.7% payout ratio. When those are settled they can be stated; until
 * then their absence is the honest version.
 */
export function ArcadePaymentNotice({className = ''}: {className?: string}) {
  return (
    <aside className={`border border-hairline bg-paper-raised p-5 ${className}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone="arc">Coming soon</Pill>
        <Label>Pay with $ARCADE</Label>
      </div>

      <p className="mt-4 max-w-[58ch] text-[0.9375rem] leading-relaxed text-ink-muted">
        Spins will be payable in $ARCADE, with rewards still paid in the reward tokens. Today
        every machine takes native USDC, and that is what the contract accepts — this is a
        direction, not a switch waiting to be flipped.
      </p>

      <p className="mt-3 max-w-[58ch] text-[0.8125rem] leading-relaxed text-ink-faint">
        It needs a new machine contract: the live one takes payment as the chain&apos;s native
        asset and cannot be upgraded to accept a token. No date, and no discount promised —
        both would change the economics the machines are funded against, and neither is
        decided.
      </p>

      <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href="/rewards"
          className="text-[0.8125rem] text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          $ARCADE is already a reward →
        </Link>
        <span className="font-mono text-[0.6875rem] break-all text-ink-faint">
          {ARCADE_TOKEN.address}
        </span>
      </p>
    </aside>
  )
}
