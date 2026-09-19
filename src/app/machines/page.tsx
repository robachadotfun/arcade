import type {Metadata} from 'next'
import Link from 'next/link'
import {OddsRail} from '@/components/OddsRail'
import {TokenGlyph} from '@/components/OrbitMachine'
import {ButtonLink, Label, Pill, SectionHead} from '@/components/ui/Primitives'
import {ArcadeArt, MACHINE_ART} from '@/components/ArcadeArt'
import {MACHINES, assetsOnMachine, rarityOdds, totalWeight} from '@/config/machines'
import {formatPercent} from '@/lib/format'

export const metadata: Metadata = {
  title: 'Machines',
  description:
    'Every Arcade machine, its price, its reward set and its published odds. Genesis, Velocity, Blue Chip and Discovery.',
}

export default function MachinesPage() {
  return (
    <div className="relative iso-grid">
      <div className="shell relative py-14 md:py-20">
      <SectionHead
        eyebrow="Machines"
        title={
          <>
            Five machines.
            <br />
            One economy.
          </>
        }
        lede="Each machine is a different slice of Arc: broad, fast, deep, or new. Price, reward set and odds are published before you spin."
      />

      <div className="mt-16 flex flex-col gap-px bg-hairline">
        {MACHINES.map((machine) => {
          const assets = assetsOnMachine(machine)
          const odds = rarityOdds(machine)
          const disabled = machine.status !== 'live'

          return (
            <article
              key={machine.slug}
              className={`grid gap-8 bg-paper-raised p-6 md:grid-cols-[13rem_1fr_auto] md:items-center md:gap-10 md:p-8 ${
                disabled ? 'opacity-60' : ''
              }`}
            >
              <div className="mx-auto w-full max-w-[13rem]">
                <ArcadeArt
                  name={MACHINE_ART[machine.slug] ?? 'genesis-machine'}
                  sizes="(min-width: 768px) 13rem, 60vw"
                />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h2 className="font-display text-[1.75rem] leading-tight text-ink">
                    {machine.name}
                  </h2>
                  <Pill tone={disabled ? 'neutral' : 'live'}>
                    {disabled ? machine.status : 'Live'}
                  </Pill>
                </div>
                <p className="mt-1.5 text-[0.9375rem] text-ink-faint">{machine.tagline}</p>
                <p className="mt-4 max-w-[54ch] text-[0.9375rem] leading-relaxed text-ink-muted">
                  {machine.description}
                </p>

                <ul className="mt-5 flex flex-wrap gap-2">
                  {assets.map((asset) => (
                    <li
                      key={asset.address}
                      className="flex items-center gap-1.5 border border-hairline px-2 py-1"
                    >
                      <TokenGlyph asset={asset} size={16} />
                      <span className="text-[0.75rem] text-ink-soft">{asset.symbol}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6 max-w-[26rem]">
                  <OddsRail odds={odds} height={6} showLegend={false} />
                  <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
                    {odds.map((band) => (
                      <div key={band.rarity} className="flex items-baseline gap-1.5">
                        <dt className="micro text-ink-faint">{band.rarity}</dt>
                        <dd className="font-mono text-[0.6875rem] text-ink-muted" data-numeric="">
                          {formatPercent(band.probability)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>

              <div className="flex flex-col items-start gap-4 md:items-end">
                <div className="md:text-right">
                  <Label>Spin</Label>
                  <p className="mt-1 font-display text-[2.25rem] leading-none text-ink" data-numeric="">
                    ${machine.spinPriceUsdc}
                  </p>
                </div>

                <dl className="flex gap-6 md:flex-col md:gap-1 md:text-right">
                  <div>
                    <dt className="micro text-ink-faint">Bands</dt>
                    <dd className="font-mono text-[0.8125rem] text-ink" data-numeric="">
                      {machine.tiers.length}
                    </dd>
                  </div>
                  <div>
                    <dt className="micro text-ink-faint">Weight</dt>
                    <dd className="font-mono text-[0.8125rem] text-ink" data-numeric="">
                      {totalWeight(machine).toLocaleString('en-US')}
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-col gap-2">
                  {disabled ? (
                    <span className="micro text-ink-faint">Not accepting spins</span>
                  ) : (
                    <ButtonLink href={`/play?machine=${machine.slug}`}>
                      Spin ${machine.spinPriceUsdc}
                    </ButtonLink>
                  )}
                  <Link
                    href={`/machines/${machine.slug}`}
                    className="text-center text-[0.8125rem] text-arc underline decoration-arc/25 underline-offset-[3px] hover:decoration-arc"
                  >
                    Details
                  </Link>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      <p className="mt-10 max-w-[70ch] text-[0.8125rem] leading-relaxed text-ink-faint">
        Machine configurations shown here are the development defaults. In a live deployment the
        price, reward table and odds are read from the machine manager contract, and each
        published version is sealed onchain with its own configuration hash.
      </p>
      </div>
    </div>
  )
}
