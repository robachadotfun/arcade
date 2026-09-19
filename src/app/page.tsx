import Link from 'next/link'
import {HeroGeometry, StepDiagram, CrossingArc} from '@/components/ArcGeometry'
import {ButtonLink, Label, Pill, Dot, SectionHead} from '@/components/ui/Primitives'
import {OddsRail} from '@/components/OddsRail'
import {HeroOrbit} from '@/components/HeroOrbit'
import {FeaturedMachine} from '@/components/FeaturedMachine'
import {ActivityPreview} from '@/components/ActivityPreview'
import {FaqAccordion} from '@/components/FaqAccordion'
import {machineBySlug, rarityOdds, LIVE_MACHINES, assetsOnMachine} from '@/config/machines'
import {REWARD_ASSETS, VERIFICATION_META} from '@/config/rewards'
import {resolveMode, MODE_DESCRIPTION} from '@/config/mode'
import {TokenGlyph} from '@/components/OrbitMachine'
import {ArcadeArt, MACHINE_ART} from '@/components/ArcadeArt'
import {EditorialImage} from '@/components/EditorialImage'
import {formatCount} from '@/lib/format'
import {HOME_FAQ} from '@/content/faq'

const STEPS = [
  {index: '01', title: 'Connect', detail: 'Any EVM wallet. Arcade never sees your keys.'},
  {index: '02', title: 'Choose a machine', detail: 'Each one publishes its price, assets and odds.'},
  {index: '03', title: 'Pay in USDC', detail: 'Native USDC on Arc. One signature, no approval step.'},
  {index: '04', title: 'Receive the result', detail: 'Decided onchain, settled to your wallet, verifiable by anyone.'},
]

export default function HomePage() {
  const genesis = machineBySlug('genesis')
  const status = resolveMode()
  const odds = genesis ? rarityOdds(genesis) : []
  const genesisAssets = genesis ? assetsOnMachine(genesis) : []
  const cheapest = Math.min(...LIVE_MACHINES.map((m) => Number.parseFloat(m.spinPriceUsdc)))

  return (
    <>
      {/* ======================================================================= hero */}
      <section className="relative overflow-hidden">
        <HeroGeometry />
        <div className="shell relative grid items-center gap-14 pt-16 pb-20 lg:grid-cols-[1.18fr_0.82fr] lg:gap-12 lg:pt-24 lg:pb-32">
          <div>
            <div className="flex items-center gap-3">
              <Dot tone={status.mode === 'demo' ? 'warn' : 'live'} pulse />
              <Label>{status.mode === 'demo' ? 'Demo mode' : 'Arc Mainnet'}</Label>
            </div>

            <h1 className="mt-7 text-mega text-ink">
              Play the
              <br />
              economic layer.
            </h1>

            <p className="mt-8 max-w-[38ch] text-lede text-ink-muted">
              One spin. One onchain outcome. Win tokens from across Arc.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <ButtonLink href="/play" size="lg" className="min-w-[11rem]">
                Enter Arcade
              </ButtonLink>
              <Link
                href="/rewards"
                className="group inline-flex items-center gap-2 text-[0.9375rem] text-ink transition-colors hover:text-arc"
              >
                See what&apos;s inside
                <svg viewBox="0 0 14 14" className="size-3 transition-transform duration-300 group-hover:translate-x-0.5" fill="none" aria-hidden="true">
                  <path d="M2 7h9M7.5 3.5L11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </Link>
            </div>

            <p className="mt-9 flex items-center gap-3">
              <span aria-hidden="true" className="h-px w-8 bg-hairline-strong" />
              <span className="label text-ink-faint">
                From ${Number.isFinite(cheapest) ? cheapest : 2} / spin
              </span>
            </p>
          </div>

          {/* No negative margin: at 375px the orbiting glyphs would clip on both edges. */}
          <div className="relative">
            <HeroOrbit assets={genesisAssets.length ? genesisAssets : REWARD_ASSETS.slice(0, 7)} />
          </div>
        </div>
      </section>

      {/* ============================================================= network ticker */}
      <section className="hairline-t hairline-b bg-paper-deep/60">
        <div className="shell grid grid-cols-2 gap-y-8 py-10 md:grid-cols-4 md:gap-8">
          <TickerItem label="Network" value="Arc Mainnet" note="Chain 5042" />
          <TickerItem label="Gas asset" value="USDC" note="Native, 18 decimals" />
          <TickerItem
            label="Reward assets"
            value={formatCount(REWARD_ASSETS.length)}
            note={`${formatCount(VERIFICATION_META.summary.candidates)} candidates checked`}
          />
          <TickerItem
            label="Active machines"
            value={formatCount(LIVE_MACHINES.length)}
            note={status.mode === 'demo' ? 'Demo configuration' : 'Live onchain'}
          />
        </div>
      </section>

      {/* ================================================================== machine row */}
      <section className="section-y relative overflow-hidden">
        <div className="shell relative">
          <SectionHead
            eyebrow="The machines"
            title={
              <>
                Five machines.
                <br />
                One economy.
              </>
            }
            lede="Each one is a different slice of Arc: broad, fast, deep, or new."
          />
          <ul className="mt-16 grid grid-cols-2 gap-x-6 gap-y-10 md:gap-x-8 lg:grid-cols-4">
            {LIVE_MACHINES.map((m) => (
              <li key={m.slug}>
                <Link href={`/machines/${m.slug}`} className="group block">
                  <ArcadeArt
                    name={MACHINE_ART[m.slug] ?? 'genesis-machine'}
                    sizes="(min-width: 1024px) 18vw, 45vw"
                    className="transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                  <p className="mt-4 flex items-baseline justify-between gap-2">
                    <span className="font-display text-[1.125rem] leading-none text-ink">
                      {m.name}
                    </span>
                    <span className="font-mono text-[0.75rem] text-ink-faint" data-numeric="">
                      ${m.spinPriceUsdc}
                    </span>
                  </p>
                  <p className="mt-1.5 text-[0.8125rem] leading-snug text-ink-muted">{m.tagline}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* =============================================================== how it works */}
      <section className="section-y relative hairline-t">
        <div className="shell">
          <SectionHead
            eyebrow="How a spin works"
            title={
              <>
                Four seconds.
                <br />
                Four steps.
              </>
            }
          />
          <div className="mt-16">
            <StepDiagram steps={STEPS} />
          </div>

          <ArcadeArt
            name="settlement"
            className="mx-auto mt-16 max-w-[56rem]"
            sizes="(min-width: 1024px) 56rem, 100vw"
          />
        </div>
      </section>

      {/* ============================================================ featured machine */}
      {genesis ? (
        <section className="relative overflow-hidden hairline-t bg-paper-raised iso-grid">
          <div className="shell section-y relative">
            <FeaturedMachine machine={genesis} />
          </div>
        </section>
      ) : null}

      {/* ========================================================================= odds */}
      <section className="section-y relative overflow-hidden">
        <CrossingArc className="top-0" />
        <div className="shell relative">
          <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div>
              <SectionHead
                eyebrow="Odds"
                title={
                  <>
                    Know the odds
                    <br />
                    before you spin.
                  </>
                }
                lede="Every machine publishes its active reward table before the spin, not after."
              />
              <ArcadeArt
                name="reward-chamber"
                className="mt-12 max-w-[22rem]"
                sizes="(min-width: 1024px) 30vw, 70vw"
                caption="The chamber, with one outcome settled at its centre."
              />
            </div>

            {genesis ? (
              <div>
                <div className="flex items-baseline justify-between gap-4">
                  <Label>{genesis.name} — rarity distribution</Label>
                  <Pill tone="neutral">
                    {status.mode === 'demo' ? 'Demo config' : 'Live config'}
                  </Pill>
                </div>
                <OddsRail odds={odds} height={12} className="mt-5" />

                <p className="mt-8 max-w-[52ch] text-[0.9375rem] leading-relaxed text-ink-muted">
                  Rarity bands are published as weights, and the winning band is derived from a
                  random word that is fixed onchain before anything animates on your screen.
                </p>

                {/* The four bands as physical objects: the same glass sphere, four ways. */}
                <ul className="mt-10 grid grid-cols-4 gap-4">
                  {(['common', 'rare', 'ultra', 'jackpot'] as const).map((band) => (
                    <li key={band} className="text-center">
                      <ArcadeArt
                        name={`rarity-${band}` as const}
                        sizes="(min-width: 1024px) 12vw, 22vw"
                      />
                      <span className="micro mt-3 block text-ink-faint">{band}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={`/machines/${genesis.slug}`}
                  className="mt-8 inline-flex items-center gap-2 text-[0.9375rem] text-arc underline decoration-arc/25 underline-offset-[3px] hover:decoration-arc"
                >
                  View full table
                  <svg viewBox="0 0 14 14" className="size-3" fill="none" aria-hidden="true">
                    <path d="M2 7h9M7.5 3.5L11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* ============================================================ the arc economy */}
      <section className="relative hairline-t hairline-b overflow-hidden bg-powder/25">
        <div className="shell section-y relative">
          <div className="max-w-[52rem]">
            <SectionHead
              eyebrow="Reward set"
              title={
                <>
                  The Arc economy,
                  <br />
                  in one machine.
                </>
              }
              lede={`Every asset below was verified against Arc Mainnet at block ${Number(VERIFICATION_META.verifiedAtBlock).toLocaleString('en-US')} — contract address, decimals, and a live transfer probe confirming the full amount actually arrives.`}
            />
          </div>

          <div className="mt-14 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <ArcadeArt name="rewards-array" sizes="(min-width: 1024px) 55vw, 100vw" />
            <ArcadeArt name="network-arc" sizes="(min-width: 1024px) 38vw, 100vw" />
          </div>

          <ul className="mt-12 flex flex-wrap gap-3">
            {REWARD_ASSETS.map((asset) => (
              <li key={asset.address}>
                <Link
                  href={`/rewards#${asset.symbol.toLowerCase()}`}
                  className="flex items-center gap-2.5 border border-hairline bg-paper-raised px-3 py-2 transition-colors hover:border-hairline-strong"
                >
                  <TokenGlyph asset={asset} size={22} />
                  <span className="text-[0.875rem] text-ink">{asset.symbol}</span>
                  <span className="micro text-ink-faint">{asset.decimals}d</span>
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-10 max-w-[58ch] text-[0.875rem] leading-relaxed text-ink-muted">
            &ldquo;Verified by Arcade&rdquo; means we checked the token contract — right address,
            honest decimals, transfers that do not skim. It is not an endorsement of the asset
            and not a claim about its value.
          </p>
        </div>
      </section>

      {/* ======================================================== rotation / settlement */}
      <section className="section-y">
        <div className="shell grid gap-16 md:grid-cols-2 md:gap-12 lg:gap-20">
          <div>
            <SectionHead
              eyebrow="Rotation"
              title={
                <>
                  Arc moves fast.
                  <br />
                  So do the machines.
                </>
              }
              lede="Arc mainnet opened on 16 September 2026. Rankings will churn for months, so no reward list is baked into this site."
            />
            <p className="mt-7 max-w-[46ch] text-[0.9375rem] leading-relaxed text-ink-muted">
              Machines read their reward tables from a registry that an operator can re-tier,
              pause or extend. Discovery rotates fastest; Blue Chip barely moves. A new reward
              table is a new machine <em>version</em>, sealed onchain with its own hash, so a
              spin from last week can still be audited against the exact table it played.
            </p>

            <ArcadeArt
              name="machine-zero"
              className="mt-10"
              sizes="(min-width: 768px) 45vw, 100vw"
              caption="Machine Zero: where a new mechanic is assembled before it reaches a live machine."
            />
          </div>

          <div>
            <SectionHead eyebrow="Settlement" title="Settled on Arc." />
            <ol className="mt-8 divide-y divide-hairline border-y border-hairline">
              {[
                ['USDC payment', 'Native USDC, one signature. The price is locked when the spin is accepted.'],
                ['Randomness', 'A pre-published commitment is consumed, then revealed. Nobody can swap it.'],
                ['Reward', 'The winning band and amount are derived from the revealed word.'],
                ['Transaction', 'Reserved in the vault, sent to your wallet, recorded onchain.'],
              ].map(([title, detail], i) => (
                <li key={title} className="flex gap-5 py-5">
                  <span className="micro shrink-0 pt-1 text-ink-faint">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div>
                    <h3 className="font-display text-[1.125rem] leading-snug text-ink">{title}</h3>
                    <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-muted">{detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <ArcadeArt
              name="fairness-commitment"
              className="mt-8"
              sizes="(min-width: 768px) 45vw, 100vw"
              caption="A commitment, sealed before your spin exists."
            />

            <Link
              href="/fairness"
              className="mt-7 inline-flex items-center gap-2 text-[0.9375rem] text-arc underline decoration-arc/25 underline-offset-[3px] hover:decoration-arc"
            >
              How verification works
            </Link>
          </div>
        </div>
      </section>

      {/* ===================================================================== activity */}
      <section className="relative overflow-hidden hairline-t bg-paper-deep/50 iso-grid">
        <div className="shell section-y relative">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHead eyebrow="Live activity" title="Every spin in the open." />
            <Link
              href="/activity"
              className="text-[0.9375rem] text-arc underline decoration-arc/25 underline-offset-[3px] hover:decoration-arc"
            >
              Full tape
            </Link>
          </div>
          <div className="mt-12">
            <ActivityPreview />
          </div>
        </div>
      </section>

      {/* ========================================================================== faq */}
      <section className="section-y">
        <div className="shell grid gap-14 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20">
          <SectionHead
            eyebrow="FAQ"
            title={
              <>
                Questions worth
                <br />
                asking first.
              </>
            }
          />
          <div>
            <EditorialImage
              name="machined-ring"
              alt="A sectioned Rolls-Royce Turboméca Adour turbofan seen head-on, its machined intake ring and fan blades exposed."
              caption="A machine is only as trustworthy as the tolerances you can inspect."
              aspect="21 / 9"
              className="mb-12"
              sizes="(min-width: 1024px) 65vw, 100vw"
            />
            <FaqAccordion items={HOME_FAQ} />
          </div>
        </div>
      </section>

      {/* ======================================================================== close */}
      <section className="relative overflow-hidden hairline-t bg-cream/50">
        <div className="shell relative py-24 text-center md:py-32">
          <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
            <svg viewBox="0 0 600 600" className="h-[110%] w-auto opacity-60" fill="none">
              <circle cx="300" cy="300" r="240" stroke="var(--color-hairline)" strokeWidth="1" />
              <circle cx="300" cy="300" r="180" stroke="var(--color-hairline-faint)" strokeWidth="1" />
              <circle cx="300" cy="300" r="290" stroke="var(--color-hairline-faint)" strokeWidth="1" />
            </svg>
          </div>
          <div className="relative">
            <ArcadeArt
              name="reward-chamber"
              className="mx-auto mb-12 w-full max-w-[16rem]"
              sizes="16rem"
            />
            <h2 className="mx-auto max-w-[24ch] text-display text-ink">
              One spin. One onchain outcome.
            </h2>
            <p className="mx-auto mt-7 max-w-[42ch] text-lede text-ink-muted">
              {MODE_DESCRIPTION[status.mode]}
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <ButtonLink href="/play" size="lg" className="min-w-[11rem]">
                Enter Arcade
              </ButtonLink>
              <ButtonLink href="/machines" variant="secondary" size="lg">
                Browse machines
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function TickerItem({label, value, note}: {label: string; value: string; note: string}) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-2.5 font-display text-[1.5rem] leading-none text-ink" data-numeric="">
        {value}
      </p>
      <p className="mt-2 text-[0.8125rem] text-ink-faint">{note}</p>
    </div>
  )
}
