import Link from 'next/link'
import {OddsRail, RarityTag} from './OddsRail'
import {TokenGlyph} from './OrbitMachine'
import {StaticOrbit} from './StaticOrbit'
import {ButtonLink, Label, Pill} from './ui/Primitives'
import {assetsOnMachine, rarityOdds, tierOdds, type MachineConfig} from '@/config/machines'
import {OnchainConfigHash} from './OnchainConfigHash'
import {formatDecimalAmount, formatPercent} from '@/lib/format'

/**
 * The homepage's functional machine preview: orbital visual on the left, the spin control in
 * the middle, reward inventory and rarity on the right. One composed horizontal instrument
 * rather than three stacked cards.
 *
 * Server-rendered. The interactive machine lives on /play and /machines/[slug] — this is the
 * shop window, and it says so rather than pretending to be playable.
 */
export function FeaturedMachine({machine}: {machine: MachineConfig}) {
  const assets = assetsOnMachine(machine)
  const odds = rarityOdds(machine)
  const tiers = tierOdds(machine)

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="mb-5 flex items-center gap-3">
            <span aria-hidden="true" className="h-px w-8 bg-hairline-strong" />
            <Label>Featured machine</Label>
          </div>
          <h2 className="text-title text-ink">{machine.name}</h2>
          <p className="mt-3 text-lede text-ink-muted">{machine.tagline}</p>
        </div>
        <Pill tone="live">
          Config <OnchainConfigHash machine={machine} className="ml-1" />
        </Pill>
      </div>

      <div className="mt-14 grid gap-12 border-y border-hairline py-12 lg:grid-cols-[0.85fr_0.7fr_1fr] lg:gap-10">
        {/* --------------------------------------------------------- orbital visual */}
        <div className="mx-auto w-full max-w-[22rem] lg:max-w-none">
          <StaticOrbit assets={assets} />
        </div>

        {/* ------------------------------------------------------------ spin control */}
        <div className="flex flex-col justify-center gap-6 border-hairline lg:border-x lg:px-10">
          <div>
            <Label>Spin price</Label>
            <p className="mt-2 font-display text-display leading-none text-ink" data-numeric="">
              {machine.spinPriceUsdc}
              <span className="ml-2 font-sans text-[1rem] font-normal tracking-normal text-ink-muted">
                USDC
              </span>
            </p>
            <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink-faint">
              Native USDC. One signature, no approval step.
            </p>
          </div>

          <ButtonLink href={`/play?machine=${machine.slug}`} size="lg">
            Spin {machine.spinPriceUsdc} USDC
          </ButtonLink>

          <dl className="flex flex-col gap-2.5 text-[0.8125rem]">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-faint">Reward assets</dt>
              <dd className="text-ink" data-numeric="">
                {assets.length}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-faint">Reward bands</dt>
              <dd className="text-ink" data-numeric="">
                {machine.tiers.length}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-faint">Best odds</dt>
              <dd className="text-ink" data-numeric="">
                {formatPercent(Math.max(...odds.map((o) => o.probability)))}
              </dd>
            </div>
          </dl>
        </div>

        {/* ---------------------------------------------------- inventory and rarity */}
        <div>
          <Label>Reward table</Label>
          <ul className="mt-4 divide-y divide-hairline-faint border-y border-hairline-faint">
            {tiers.map(({tier, asset, probability}, i) => (
              <li key={`${tier.token}-${tier.rarity}-${i}`} className="flex items-center gap-3 py-3">
                {asset ? <TokenGlyph asset={asset} size={26} /> : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-[0.9375rem] text-ink">
                      {asset?.symbol ?? 'Unknown'}
                    </span>
                    <RarityTag rarity={tier.rarity} />
                  </div>
                  <p className="mt-0.5 font-mono text-[0.75rem] text-ink-faint" data-numeric="">
                    {formatDecimalAmount(Number.parseFloat(tier.minAmount))}
                    {tier.minAmount !== tier.maxAmount
                      ? ` – ${formatDecimalAmount(Number.parseFloat(tier.maxAmount))}`
                      : ''}
                  </p>
                </div>
                <span className="font-mono text-[0.8125rem] text-ink" data-numeric="">
                  {formatPercent(probability)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-6">
            <OddsRail odds={odds} height={8} showLegend={false} />
          </div>

          <Link
            href={`/machines/${machine.slug}`}
            className="mt-5 inline-flex items-center gap-2 text-[0.875rem] text-arc underline decoration-arc/25 underline-offset-[3px] hover:decoration-arc"
          >
            Machine detail and recent spins
          </Link>
        </div>
      </div>
    </div>
  )
}
