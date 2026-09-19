import type {Metadata} from 'next'
import {notFound} from 'next/navigation'
import Link from 'next/link'
import {StaticOrbit} from '@/components/StaticOrbit'
import {OddsRail, RarityTag} from '@/components/OddsRail'
import {TokenGlyph} from '@/components/OrbitMachine'
import {MachineActivity} from '@/components/MachineActivity'
import {ButtonLink, DataRow, Label, Pill, SectionHead, ExternalLink} from '@/components/ui/Primitives'
import {
  MACHINES,
  assetsOnMachine,
  demoConfigFingerprint,
  machineBySlug,
  rarityOdds,
  tierOdds,
  totalWeight,
} from '@/config/machines'
import {resolveMode} from '@/config/mode'
import {explorerUrl, ARC_MAINNET_ID} from '@/config/network'
import {formatDecimalAmount, formatPercent} from '@/lib/format'
import {evaluateMachine} from '@/lib/economics'
import {EditorialImage} from '@/components/EditorialImage'
import {ArcadeArt, MACHINE_ART, RARITY_ART} from '@/components/ArcadeArt'

export function generateStaticParams() {
  return MACHINES.map((m) => ({slug: m.slug}))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{slug: string}>
}): Promise<Metadata> {
  const {slug} = await params
  const machine = machineBySlug(slug)
  if (!machine) return {title: 'Machine not found'}
  return {
    title: machine.name,
    description: `${machine.description} Spin price ${machine.spinPriceUsdc} USDC on Arc.`,
  }
}

export default async function MachineDetailPage({params}: {params: Promise<{slug: string}>}) {
  const {slug} = await params
  const machine = machineBySlug(slug)
  if (!machine) notFound()

  const status = resolveMode()
  const assets = assetsOnMachine(machine)
  const odds = rarityOdds(machine)
  const tiers = tierOdds(machine)
  const chainId = status.kind === 'ready' && status.chainId ? status.chainId : ARC_MAINNET_ID
  const contracts = status.kind === 'ready' ? status.contracts : null

  // Worst-case liability per token, shown in token units. No price data is involved, which
  // is exactly why it is the number worth publishing.
  const economics = evaluateMachine(machine, {prices: {}, capturedAt: '—', source: 'none'})

  return (
    <div className="relative iso-grid">
      <div className="shell relative py-14 md:py-20">
      <nav aria-label="Breadcrumb" className="mb-8">
        <Link href="/machines" className="label text-ink-faint transition-colors hover:text-ink">
          ← All machines
        </Link>
      </nav>

      <div className="grid gap-12 lg:grid-cols-[1fr_0.8fr] lg:gap-16">
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-display text-ink">{machine.name}</h1>
            <Pill tone={machine.status === 'live' ? 'live' : 'neutral'}>
              {machine.status === 'live' ? 'Live' : machine.status}
            </Pill>
          </div>
          <p className="mt-3 text-lede text-ink-faint">{machine.tagline}</p>
          <p className="mt-6 max-w-[56ch] text-lede text-ink-muted">{machine.description}</p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            {machine.status === 'live' ? (
              <ButtonLink href={`/play?machine=${machine.slug}`} size="lg">
                Spin {machine.spinPriceUsdc} USDC
              </ButtonLink>
            ) : (
              <Pill tone="neutral">Not accepting spins</Pill>
            )}
            <Link
              href="/fairness"
              className="text-[0.9375rem] text-arc underline decoration-arc/25 underline-offset-[3px] hover:decoration-arc"
            >
              How the outcome is decided
            </Link>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[22rem]">
          <ArcadeArt
            name={MACHINE_ART[machine.slug] ?? 'genesis-machine'}
            sizes="(min-width: 1024px) 22rem, 80vw"
            priority
          />
          <div className="mt-6">
            <StaticOrbit
              assets={assets}
              centreLabel="Spin"
              centreValue={`${machine.spinPriceUsdc} USDC`}
            />
          </div>
        </div>
      </div>

      {/* =================================================================== odds table */}
      <section className="mt-20 md:mt-28">
        <SectionHead eyebrow="Published reward table" title="Every band, before you spin." />

        <div className="mt-8 max-w-[38rem]">
          <OddsRail odds={odds} height={12} />
        </div>

        <ul className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-4 lg:max-w-[46rem]">
          {odds.map((band) => (
            <li key={band.rarity}>
              <ArcadeArt
                name={RARITY_ART[band.rarity] ?? 'rarity-common'}
                sizes="(min-width: 1024px) 11rem, 40vw"
              />
              <p className="mt-3 flex items-baseline justify-between gap-2">
                <span className="micro text-ink-faint">{band.rarity}</span>
                <span className="font-mono text-[0.75rem] text-ink" data-numeric="">
                  {formatPercent(band.probability)}
                </span>
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left">
            <caption className="sr-only">
              Reward table for {machine.name}: asset, rarity band, reward range and probability.
            </caption>
            <thead>
              <tr className="border-y border-hairline">
                <th scope="col" className="label py-3 pr-4 text-ink-faint">
                  Asset
                </th>
                <th scope="col" className="label py-3 pr-4 text-ink-faint">
                  Contract
                </th>
                <th scope="col" className="label py-3 pr-4 text-ink-faint">
                  Rarity
                </th>
                <th scope="col" className="label py-3 pr-4 text-right text-ink-faint">
                  Reward range
                </th>
                <th scope="col" className="label py-3 pr-4 text-right text-ink-faint">
                  Weight
                </th>
                <th scope="col" className="label py-3 text-right text-ink-faint">
                  Probability
                </th>
              </tr>
            </thead>
            <tbody>
              {tiers.map(({tier, asset, probability}, i) => (
                <tr key={`${tier.token}-${tier.rarity}-${i}`} className="border-b border-hairline-faint">
                  <td className="py-3.5 pr-4">
                    <span className="flex items-center gap-2.5">
                      {asset ? <TokenGlyph asset={asset} size={24} /> : null}
                      <span>
                        <span className="block text-[0.9375rem] text-ink">
                          {asset?.symbol ?? 'Unknown'}
                        </span>
                        <span className="block text-[0.75rem] text-ink-faint">
                          {asset?.name ?? tier.token}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="py-3.5 pr-4">
                    <ExternalLink href={explorerUrl(chainId, 'token', tier.token)}>
                      <span className="font-mono text-[0.75rem]">
                        {tier.token.slice(0, 8)}…{tier.token.slice(-6)}
                      </span>
                    </ExternalLink>
                  </td>
                  <td className="py-3.5 pr-4">
                    <RarityTag rarity={tier.rarity} />
                  </td>
                  <td className="py-3.5 pr-4 text-right font-mono text-[0.8125rem] text-ink" data-numeric="">
                    {formatDecimalAmount(Number.parseFloat(tier.minAmount))}
                    {tier.minAmount !== tier.maxAmount
                      ? ` – ${formatDecimalAmount(Number.parseFloat(tier.maxAmount))}`
                      : ''}
                  </td>
                  <td className="py-3.5 pr-4 text-right font-mono text-[0.8125rem] text-ink-muted" data-numeric="">
                    {tier.weight.toLocaleString('en-US')}
                  </td>
                  <td className="py-3.5 text-right font-mono text-[0.8125rem] text-ink" data-numeric="">
                    {formatPercent(probability)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-b border-hairline">
                <td colSpan={4} className="py-3 pr-4 label text-ink-faint">
                  Total
                </td>
                <td className="py-3 pr-4 text-right font-mono text-[0.8125rem] text-ink" data-numeric="">
                  {totalWeight(machine).toLocaleString('en-US')}
                </td>
                <td className="py-3 text-right font-mono text-[0.8125rem] text-ink" data-numeric="">
                  100%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* ============================================================== config + liability */}
      <section className="mt-20 grid gap-12 md:grid-cols-2 md:gap-16">
        <div>
          <Label>Configuration</Label>
          <dl className="mt-4 divide-y divide-hairline-faint border-y border-hairline-faint">
            <DataRow label="Machine" value={machine.name} />
            <DataRow label="Spin price" value={`${machine.spinPriceUsdc}.00 USDC`} />
            <DataRow label="Config fingerprint" value={demoConfigFingerprint(machine)} mono />
            <DataRow
              label="Onchain id"
              value={machine.onchainId === null ? 'Not deployed' : `#${machine.onchainId}`}
            />
            <DataRow
              label="Version source"
              value={status.mode === 'demo' ? 'Development config' : 'Machine manager contract'}
            />
            {contracts && status.mode !== 'demo' ? (
              <DataRow
                label="Contract"
                value={
                  <ExternalLink href={explorerUrl(chainId, 'address', contracts.machineManager)}>
                    <span className="font-mono text-[0.75rem]">
                      {contracts.machineManager.slice(0, 10)}…
                    </span>
                  </ExternalLink>
                }
              />
            ) : null}
          </dl>

          {status.mode === 'demo' ? (
            <p className="mt-5 text-[0.8125rem] leading-relaxed text-ink-faint">
              The fingerprint above is a deterministic hash of this development configuration,
              prefixed <code className="font-mono">demo-</code> so it cannot be mistaken for an
              onchain config hash. A deployed machine publishes a real keccak256 hash covering
              its id, version, price and full reward table.
            </p>
          ) : null}
        </div>

        <div>
          <Label>Maximum liability</Label>
          <p className="mt-3 max-w-[46ch] text-[0.875rem] leading-relaxed text-ink-muted">
            The most this machine could owe per spin, per asset, in that asset&apos;s own units. The
            contract refuses a spin unless the vault can already cover every one of these for this
            spin and every spin still in flight.
          </p>
          <dl className="mt-5 divide-y divide-hairline-faint border-y border-hairline-faint">
            {economics.liabilities.map((liability) => (
              <DataRow
                key={liability.address}
                label={liability.symbol}
                value={
                  <span className="font-mono text-[0.8125rem]" data-numeric="">
                    {formatDecimalAmount(liability.worstCasePerSpin)}
                  </span>
                }
              />
            ))}
          </dl>
          <p className="mt-4 text-[0.8125rem] leading-relaxed text-ink-faint">
            Quoted in token units rather than dollars on purpose: the onchain solvency check
            never depends on a price feed, so neither does this figure.
          </p>

          <ArcadeArt
            name="vault"
            className="mt-8"
            sizes="(min-width: 768px) 45vw, 100vw"
            caption="Inventory is held, counted, and never withdrawable once it is owed."
          />

          <EditorialImage
            name="machined-ring"
            alt="A sectioned Rolls-Royce Turboméca Adour turbofan seen head-on, its machined intake ring and fan blades exposed."
            caption="A machine is only as trustworthy as the tolerances you can inspect."
            aspect="4 / 3"
            className="mt-8"
            sizes="(min-width: 768px) 45vw, 100vw"
          />
        </div>
      </section>

      {/* ==================================================================== activity */}
      <section className="mt-20 md:mt-28">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHead eyebrow="Recent spins" title={`${machine.name} tape`} />
          <Link
            href="/activity"
            className="text-[0.9375rem] text-arc underline decoration-arc/25 underline-offset-[3px] hover:decoration-arc"
          >
            All activity
          </Link>
        </div>
        <div className="mt-10">
          <MachineActivity machineSlug={machine.slug} machineName={machine.name} />
        </div>
      </section>

      <p className="mt-16 max-w-[70ch] border-t border-hairline pt-8 text-[0.8125rem] leading-relaxed text-ink-faint">
        A spin buys a randomised outcome. Most outcomes are worth less than the spin price, and
        the reward assets are volatile — some are thinly traded. Nothing on this page is a
        prediction or a promise of value. Arcade is independent and is not affiliated with or
        endorsed by Circle or Arc.
      </p>
      </div>
    </div>
  )
}
