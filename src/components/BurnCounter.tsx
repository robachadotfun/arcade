'use client'

import {useReadContract} from 'wagmi'
import {formatUnits} from 'viem'
import {ARCADE_TOKEN, BURN_ADDRESS} from '@/config/token'
import {resolveMode} from '@/config/mode'
import {explorerUrl} from '@/config/network'
import {expectedChain} from '@/config/wagmi'
import {Label, ExternalLink} from './ui/Primitives'
import {formatDecimalAmount} from '@/lib/format'

/**
 * How much $ARCADE has been taken out of circulation, read live from the chain.
 *
 * ## Why this is a balance and not a counter we keep
 *
 * The number is `balanceOf(burnAddress)` — one call, no database, no tally this app maintains
 * and could get wrong. Anyone can make the same call and get the same answer, which is the
 * only kind of number this product should display about itself.
 *
 * ## The wording matters
 *
 * ARCADE has no `burn()`; the call reverts. So tokens are sent to an address whose private
 * key cannot exist. `totalSupply()` does not decrease — the circulating amount does. Saying
 * "burned" while the supply figure is unchanged would be the kind of small lie this codebase
 * exists to avoid, so the copy says "sent to a burn address" and shows the share of supply
 * rather than implying the supply shrank.
 *
 * ## Why the share of supply is a stat and not the subtitle
 *
 * It used to sit directly under the headline number, where the first thing anyone read was
 * "under 0.01% of supply" — a true figure doing the work of an apology, undercutting the
 * number it was supposed to support. It is still on the page, unrounded and linked, because
 * removing it would be hiding. It is just no longer the loudest thing after the total.
 *
 * Renders nothing when nothing has been sent. A burn counter reading zero is an
 * advertisement for something that has not happened yet.
 */
export function BurnCounter({className = ''}: {className?: string}) {
  const status = resolveMode()
  const chainId = status.kind === 'ready' ? status.chainId : expectedChain.id

  const {data, isLoading} = useReadContract({
    address: ARCADE_TOKEN.address,
    abi: [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{name: 'account', type: 'address'}],
        outputs: [{type: 'uint256'}],
      },
    ] as const,
    functionName: 'balanceOf',
    args: [BURN_ADDRESS],
    query: {refetchInterval: 60_000},
  })

  if (isLoading || data === undefined) return null

  const burned = Number(formatUnits(data, ARCADE_TOKEN.decimals))
  // Dust from a stray transfer is not a buyback programme. Below a token, say nothing.
  if (burned < 1) return null

  const share = (burned / ARCADE_TOKEN.totalSupply) * 100

  return (
    <section className={`hairline-b bg-paper-deep/40 ${className}`}>
      <div className="shell grid gap-10 py-14 md:grid-cols-[1.1fr_1fr] md:items-end md:gap-16 md:py-16">
        {/* ------------------------------------------------------------- the number */}
        <div>
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="h-px w-8 bg-hairline-strong" />
            <Label>$ARCADE removed from circulation</Label>
          </div>

          <p
            className="mt-6 font-display text-[clamp(3.25rem,11vw,6rem)] leading-[0.9] tracking-tight text-ink"
            data-numeric=""
          >
            {formatDecimalAmount(burned)}
          </p>

          <p className="mt-4 max-w-[46ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            Bought on the open market with a share of profit, and sent to an address whose
            private key cannot exist.
          </p>
        </div>

        {/* ------------------------------------------------------------- the detail */}
        <div>
          <dl className="divide-y divide-hairline-faint border-y border-hairline-faint">
            <div className="flex items-baseline justify-between gap-6 py-3">
              <dt className="label shrink-0 text-ink-faint">Share of supply</dt>
              <dd className="font-mono text-[0.8125rem] text-ink" data-numeric="">
                {share < 0.01 ? '<0.01' : share.toFixed(2)}%
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-6 py-3">
              <dt className="label shrink-0 text-ink-faint">Total supply</dt>
              <dd className="font-mono text-[0.8125rem] text-ink" data-numeric="">
                1,000,000,000
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-6 py-3">
              <dt className="label shrink-0 text-ink-faint">Source</dt>
              <dd className="font-mono text-[0.8125rem] text-ink">balanceOf</dd>
            </div>
          </dl>

          <p className="mt-5 max-w-[52ch] text-[0.8125rem] leading-relaxed text-ink-faint">
            ARCADE has no burn function, so the reported total supply does not change — the
            circulating amount does. This figure is read live from the chain, not stored here.
          </p>

          <p className="mt-4">
            <ExternalLink href={explorerUrl(chainId, 'address', BURN_ADDRESS)}>
              <span className="font-mono text-[0.75rem]">Check the burn address yourself</span>
            </ExternalLink>
          </p>
        </div>
      </div>
    </section>
  )
}
