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
    <div className={`border border-hairline bg-paper-raised p-6 ${className}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-px w-6 bg-hairline-strong" />
        <Label>$ARCADE removed from circulation</Label>
      </div>

      <p
        className="mt-4 font-display text-display leading-none text-ink"
        data-numeric=""
      >
        {formatDecimalAmount(burned)}
      </p>

      <p className="mt-2 text-[0.9375rem] text-ink-muted">
        {share < 0.01 ? 'under 0.01' : share.toFixed(2)}% of the 1,000,000,000 supply
      </p>

      <p className="mt-5 max-w-[52ch] text-[0.8125rem] leading-relaxed text-ink-faint">
        Bought on the open market and sent to a burn address, which no one holds the key to.
        ARCADE has no burn function, so the reported total supply does not change — the
        circulating amount does. This figure is{' '}
        <code className="font-mono">balanceOf</code> on that address, read live; check it
        yourself.
      </p>

      <p className="mt-3">
        <ExternalLink href={explorerUrl(chainId, 'address', BURN_ADDRESS)}>
          <span className="font-mono text-[0.75rem]">View the burn address</span>
        </ExternalLink>
      </p>
    </div>
  )
}
