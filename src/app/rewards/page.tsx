import type {Metadata} from 'next'
import {RewardsTable} from '@/components/RewardsTable'
import {DataRow, Label, Pill, SectionHead, ExternalLink} from '@/components/ui/Primitives'
import {REWARD_ASSETS, REJECTED_CANDIDATES, VERIFICATION_META, TIER_LABEL, TIER_MEANING} from '@/config/rewards'
import {MACHINES, assetsOnMachine} from '@/config/machines'
import {ArcadeArt} from '@/components/ArcadeArt'
import {formatCount} from '@/lib/format'

export const metadata: Metadata = {
  title: 'Rewards',
  description:
    'Every token in the Arcade machines, verified against Arc Mainnet — contract address, decimals, and a live transfer probe. Plus everything we rejected, and why.',
}

export default function RewardsPage() {
  // Which machines can award each asset.
  const machinesByAsset = new Map<string, string[]>()
  for (const machine of MACHINES) {
    if (machine.status !== 'live') continue
    for (const asset of assetsOnMachine(machine)) {
      const key = asset.address.toLowerCase()
      machinesByAsset.set(key, [...(machinesByAsset.get(key) ?? []), machine.name])
    }
  }

  return (
    <div className="relative iso-grid">
      <div className="shell relative py-14 md:py-20">
      <SectionHead
        eyebrow="Reward registry"
        title={
          <>
            What&apos;s
            <br />
            in the machine?
          </>
        }
        lede="Every asset below was read straight off Arc Mainnet: its contract address, its real symbol and decimals, and a live transfer probe confirming the full amount actually arrives."
      />

      <ArcadeArt
        name="rewards-array"
        className="mx-auto mt-12 max-w-[52rem]"
        sizes="(min-width: 1024px) 52rem, 100vw"
        priority
      />

      {/* ============================================================ verification meta */}
      <div className="mt-14 grid gap-8 border-y border-hairline py-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Verified at block</Label>
          <p className="mt-2 font-mono text-[1.125rem] text-ink" data-numeric="">
            {Number(VERIFICATION_META.verifiedAtBlock).toLocaleString('en-US')}
          </p>
          <p className="mt-1.5 text-[0.75rem] text-ink-faint">Arc chain {VERIFICATION_META.chainId}</p>
        </div>
        <div>
          <Label>Candidates checked</Label>
          <p className="mt-2 font-mono text-[1.125rem] text-ink" data-numeric="">
            {formatCount(VERIFICATION_META.summary.candidates)}
          </p>
          <p className="mt-1.5 text-[0.75rem] text-ink-faint">
            {formatCount(VERIFICATION_META.summary.eligible)} passed ·{' '}
            {formatCount(VERIFICATION_META.summary.rejected)} rejected
          </p>
        </div>
        <div>
          <Label>Canonical USDC</Label>
          <p className="mt-2 font-mono text-[0.8125rem] break-all text-ink">
            {VERIFICATION_META.canonicalUsdc.address}
          </p>
          <p className="mt-1.5 text-[0.75rem] text-ink-faint">
            {VERIFICATION_META.canonicalUsdc.symbol} · {VERIFICATION_META.canonicalUsdc.decimals}{' '}
            decimals
          </p>
        </div>
        <div>
          <Label>Thresholds</Label>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">
            ≥ ${formatCount(VERIFICATION_META.thresholds.minLiquidityUsd)} liquidity, ≥ $
            {formatCount(VERIFICATION_META.thresholds.minVolume24hUsd)} 24h volume, ≥{' '}
            {formatCount(VERIFICATION_META.thresholds.minHolders)} holders, ≥{' '}
            {VERIFICATION_META.thresholds.minAgeDays} days old, zero transfer fee.
          </p>
        </div>
      </div>

      {/* ==================================================================== what tiers mean */}
      <section className="mt-14">
        <Label>What the labels mean</Label>
        <dl className="mt-5 grid gap-6 md:grid-cols-3">
          {(['featured', 'verified', 'discovery'] as const).map((tier) => (
            <div key={tier} className="border-l border-hairline-strong pl-4">
              <dt className="text-[0.9375rem] text-ink">{TIER_LABEL[tier]}</dt>
              <dd className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-muted">
                {TIER_MEANING[tier]}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 max-w-[64ch] border border-hairline bg-paper-deep/50 p-4 text-[0.875rem] leading-relaxed text-ink-soft">
          &ldquo;Verified by Arcade&rdquo; means we checked the token <em>contract</em> — that this
          address is what it claims to be, that its decimals match, and that a transfer moves the
          full amount. It says nothing about whether the asset is a good thing to own, and it is
          not an endorsement by us or by anyone else.
        </p>
      </section>

      {/* ======================================================================= the table */}
      <section className="mt-16">
        <RewardsTable assets={REWARD_ASSETS} machinesByAsset={machinesByAsset} />
      </section>

      <ArcadeArt
        name="verification"
        className="mx-auto mt-20 max-w-[52rem]"
        sizes="(min-width: 1024px) 52rem, 100vw"
        caption={`${VERIFICATION_META.summary.eligible} assets in, ${VERIFICATION_META.summary.rejected} turned away. The filter is the product.`}
      />

      {/* ==================================================================== rejections */}
      <section className="mt-24">
        <SectionHead
          eyebrow="Rejected"
          title="What didn't make it, and why."
          lede="Publishing the rejections says more about the filter than the list of winners does. These are real Arc tokens that failed at least one check."
        />

        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-left">
            <caption className="sr-only">
              Rejected reward candidates with the checks each one failed.
            </caption>
            <thead>
              <tr className="border-y border-hairline">
                <th scope="col" className="label py-3 pr-4 text-ink-faint">
                  Token
                </th>
                <th scope="col" className="label py-3 pr-4 text-ink-faint">
                  Contract
                </th>
                <th scope="col" className="label py-3 text-ink-faint">
                  Failed checks
                </th>
              </tr>
            </thead>
            <tbody>
              {REJECTED_CANDIDATES.map((candidate) => (
                <tr key={candidate.address} className="border-b border-hairline-faint align-top">
                  <td className="py-3.5 pr-4">
                    <span className="block text-[0.9375rem] text-ink">
                      {candidate.symbol ?? '—'}
                    </span>
                    <span className="block max-w-[22ch] truncate text-[0.75rem] text-ink-faint">
                      {candidate.name ?? 'metadata unavailable'}
                    </span>
                    {candidate.tickerCollision ? (
                      <span className="mt-1.5 inline-block">
                        <Pill tone="warn">Ticker collision</Pill>
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3.5 pr-4 font-mono text-[0.75rem] break-all text-ink-muted">
                    {candidate.address}
                  </td>
                  <td className="py-3.5">
                    <ul className="flex flex-wrap gap-1.5">
                      {candidate.reasons.map((reason) => (
                        <li key={reason} className="micro border border-hairline px-1.5 py-0.5 text-ink-muted">
                          {reason}
                        </li>
                      ))}
                    </ul>
                    {candidate.researchFlag ? (
                      <p className="mt-2 max-w-[52ch] text-[0.75rem] leading-relaxed text-signal-warn">
                        {candidate.researchFlag}
                      </p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <div className="border border-hairline p-5">
            <Label>Why ticker collisions matter</Label>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-soft">
              Research on Arc found multiple distinct tokens sharing a single ticker, including two
              separate tokens using the symbol <strong>USDC</strong> that are not Circle USDC. The
              registry therefore keys on the contract address and asserts the symbol against the
              contract. Where a ticker is ambiguous across candidates, every claimant is rejected
              rather than guessed at.
            </p>
          </div>
          <div className="border border-hairline p-5">
            <Label>Why transfer behaviour is probed</Label>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-soft">
              A token that skims a fee on transfer would under-deliver every reward, and one that
              blocks transfers would fail settlement. The verifier executes a real{' '}
              <code className="font-mono text-[0.8125rem]">transfer</code> against live mainnet
              state using an <code className="font-mono text-[0.8125rem]">eth_call</code> state
              override, and measures what actually arrives. Anything unverified fails closed.
            </p>
          </div>
        </div>
      </section>

      {/* ======================================================================= sources */}
      <section className="mt-20 border-t border-hairline pt-10">
        <Label>Sources</Label>
        <dl className="mt-5 max-w-[46rem] divide-y divide-hairline-faint border-y border-hairline-faint">
          {VERIFICATION_META.sources.map((source) => (
            <DataRow
              key={source.url}
              label={source.name}
              value={
                <span>
                  <ExternalLink href={source.url}>
                    <span className="font-mono text-[0.75rem]">{source.url}</span>
                  </ExternalLink>
                  <span className="mt-0.5 block text-[0.75rem] text-ink-faint">{source.used}</span>
                </span>
              }
            />
          ))}
        </dl>
        <ArcadeArt
          name="vault"
          className="mt-10 max-w-[32rem]"
          sizes="(min-width: 1024px) 32rem, 100vw"
          caption="Every reward is held in the vault before it can be won."
        />

        <p className="mt-6 max-w-[70ch] text-[0.8125rem] leading-relaxed text-ink-faint">
          Market-data figures are a point-in-time third-party snapshot captured on{' '}
          {VERIFICATION_META.summary.candidates > 0 ? '18 September 2026' : '—'} and are shown for
          context only. They are never used for treasury solvency: reward quantities are explicitly
          configured per machine version, and the onchain solvency check operates in token units
          with no price feed involved. Re-run{' '}
          <code className="font-mono">pnpm verify:tokens</code> to refresh this report.
        </p>
      </section>
      </div>
    </div>
  )
}
