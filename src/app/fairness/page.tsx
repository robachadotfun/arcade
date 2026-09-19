import type {Metadata} from 'next'
import Link from 'next/link'
import {SectionHead, Label, DataRow, Pill, ExternalLink} from '@/components/ui/Primitives'
import {FaqAccordion} from '@/components/FaqAccordion'
import {FairnessLedger} from '@/components/FairnessLedger'
import {FairnessDiagram} from '@/components/FairnessDiagram'
import {ArcadeArt} from '@/components/ArcadeArt'
import {FAIRNESS_FAQ} from '@/content/faq'
import {resolveMode} from '@/config/mode'
import {explorerUrl, ARC_MAINNET_ID} from '@/config/network'
import {MACHINES} from '@/config/machines'
import {OnchainConfigHash} from '@/components/OnchainConfigHash'

export const metadata: Metadata = {
  title: 'Fairness',
  description:
    'How Arcade decides an outcome: pre-published commitments, a sealed reveal, and a result anyone can recompute. Including what we cannot guarantee.',
}

export default function FairnessPage() {
  const status = resolveMode()
  const chainId = status.kind === 'ready' ? status.chainId : ARC_MAINNET_ID
  const contracts = status.kind === 'ready' ? status.contracts : null

  return (
    <div className="relative iso-grid">
      <div className="shell relative py-14 md:py-20">
      <SectionHead
        eyebrow="Fairness"
        title={
          <>
            Every spin
            <br />
            in the open.
          </>
        }
        lede="Arcade does not ask you to trust it. It publishes enough that you do not have to."
      />

      {/* ============================================================== the honest header */}
      <div className="mt-12 max-w-[62rem] border border-arc/25 bg-arc-wash p-6 md:p-8">
        <Label className="text-arc">Start here</Label>
        <h2 className="mt-4 font-display text-title text-ink">
          Arc has no VRF. So we did not claim one.
        </h2>
        <p className="mt-5 max-w-[68ch] text-[1.0625rem] leading-relaxed text-ink-soft">
          Chainlink is integrated with Arc, but that integration covers CCIP, Data Feeds, Data
          Streams and Proof of Reserve — <strong>not</strong> VRF. A lot of onchain games would
          call a blockhash-derived number &ldquo;provably fair&rdquo; and move on. Arcade uses an
          explicit commit–reveal construction instead, and states exactly what it does and does
          not guarantee.
        </p>
        <p className="mt-4 max-w-[68ch] text-[0.9375rem] leading-relaxed text-ink-muted">
          The randomness source sits behind a swappable adapter interface. If a reputable VRF
          arrives on Arc, it can be dropped in without redeploying the machines, the vault or the
          registry — and without touching any spin already in flight.
        </p>
      </div>

      {/* ====================================================================== diagram */}
      <section className="mt-20 md:mt-28">
        <SectionHead eyebrow="Mechanism" title="Pay. Lock. Randomize. Settle. Verify." />
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <ArcadeArt
            name="fairness-commitment"
            sizes="(min-width: 768px) 45vw, 100vw"
            caption="Sealed, and published before your spin exists."
          />
          <ArcadeArt
            name="fairness-reveal"
            sizes="(min-width: 768px) 45vw, 100vw"
            caption="Opened afterwards. The hash check is what makes it the same seed."
          />
        </div>

        <div className="mt-16">
          <FairnessDiagram />
        </div>
      </section>

      {/* ============================================================== what is guaranteed */}
      <section className="mt-20 grid gap-12 md:grid-cols-2 md:gap-16">
        <div>
          <Label>What this guarantees</Label>
          <ul className="mt-5 divide-y divide-hairline-faint border-y border-hairline-faint">
            {[
              [
                'The operator cannot choose your outcome',
                'The seed was committed before your spin existed, and the anchor block had not been mined. Revealing anything other than the committed pre-image fails the onchain hash check.',
              ],
              [
                'You cannot predict your outcome',
                'The seed stays hidden behind its commitment until after your spin is accepted, and the anchor blockhash does not exist when you sign.',
              ],
              [
                'There are no re-rolls',
                'Commitments are consumed in strict ascending order, one per request, exactly once. A revealed word is immutable and no admin function can overwrite it.',
              ],
              [
                'The price and table are frozen',
                'Accepting a spin copies the price, machine id and machine version into immutable storage. Publishing a new version cannot change a spin already in flight.',
              ],
              [
                'Anyone can recompute the result',
                'The revealed seed, salt, request entropy and anchor blockhash are all public. The contract exposes a pure recompute function so you can check its own stored answer.',
              ],
            ].map(([title, detail]) => (
              <li key={title} className="py-4">
                <h3 className="text-[1.0625rem] leading-snug text-ink">{title}</h3>
                <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-muted">{detail}</p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <Label>What it does not</Label>
          <div className="mt-5 border border-signal-warn/30 bg-signal-warn/4 p-5">
            <h3 className="font-display text-[1.25rem] leading-snug text-ink">
              Selective withholding
            </h3>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-soft">
              Between the anchor block and the reveal, the operator can compute your outcome and
              could choose not to publish it. That cannot <em>change</em> a result — only deny
              one.
            </p>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink-soft">
              The mitigation is mechanical, not a promise: once the reveal window closes, anyone
              can report the miss. The request is marked failed, your spin price is refunded in
              full, and a penalty is slashed from the operator&apos;s posted bond and paid to you.
              Missed reveals are counted onchain and published.
            </p>
          </div>

          <div className="mt-6 border border-hairline p-5">
            <h3 className="font-display text-[1.25rem] leading-snug text-ink">No audit</h3>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-soft">
              These contracts have <strong>not</strong> been independently audited. They ship with
              unit, fuzz and invariant tests — including a solvency invariant exercised across
              thousands of randomised call sequences — but tests are not an audit and are not
              presented as one.
            </p>
          </div>

          <div className="mt-6 border border-hairline p-5">
            <h3 className="font-display text-[1.25rem] leading-snug text-ink">
              The animation decides nothing
            </h3>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-soft">
              The orbit animates toward a result that is already fixed onchain. Close the tab
              mid-spin and the outcome is unchanged and still settleable — by you, or by anyone.
            </p>
          </div>

          <ArcadeArt
            name="verification"
            className="mt-8"
            sizes="(min-width: 768px) 45vw, 100vw"
            caption="Every input is public. Check the contract's own answer against your own."
          />
        </div>
      </section>

      {/* ======================================================================= contracts */}
      <section className="mt-20 md:mt-28">
        <SectionHead eyebrow="Contracts" title="Where to look." />
        <div className="mt-10 grid gap-10 md:grid-cols-2">
          <div>
            <Label>Deployed addresses</Label>
            {contracts ? (
              <dl className="mt-4 divide-y divide-hairline-faint border-y border-hairline-faint">
                {(
                  [
                    ['Machine manager', contracts.machineManager],
                    ['Prize vault', contracts.prizeVault],
                    ['Reward registry', contracts.rewardRegistry],
                    ['Randomness', contracts.randomness],
                    ['Fee router', contracts.feeRouter],
                  ] as const
                ).map(([label, address]) => (
                  <DataRow
                    key={label}
                    label={label}
                    value={
                      <ExternalLink href={explorerUrl(chainId, 'address', address)}>
                        <span className="font-mono text-[0.75rem] break-all">{address}</span>
                      </ExternalLink>
                    }
                  />
                ))}
              </dl>
            ) : (
              <div className="mt-4 border border-hairline bg-paper-deep/50 p-5">
                <p className="text-[0.9375rem] leading-relaxed text-ink-soft">
                  No contracts are configured for this build, so there is nothing onchain to
                  link to — and it says so rather than showing placeholder addresses.
                </p>
                <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink-faint">
                  Deploy with{' '}
                  <code className="font-mono">forge script script/Deploy.s.sol</code>, then set the
                  addresses in your environment. See{' '}
                  <Link href="/contracts" className="text-arc underline underline-offset-2">
                    Contracts
                  </Link>
                  .
                </p>
              </div>
            )}
          </div>

          <div>
            <Label>Current machine configurations</Label>
            <dl className="mt-4 divide-y divide-hairline-faint border-y border-hairline-faint">
              {MACHINES.filter((m) => m.status === 'live').map((machine) => (
                <DataRow
                  key={machine.slug}
                  label={machine.name}
                  value={<OnchainConfigHash machine={machine} className="text-[0.75rem]" />}
                />
              ))}
            </dl>
            <p className="mt-4 text-[0.8125rem] leading-relaxed text-ink-faint">
              Each is the <code className="font-mono">configHash</code> that{' '}
              <code className="font-mono">publishVersion</code> sealed onchain — a keccak256 over
              the machine id, version, spin price, effective block and the full reward table.
              Read it from the contract yourself and compare.
            </p>
          </div>
        </div>
      </section>

      {/* ========================================================================= ledger */}
      <section className="mt-20 md:mt-28">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHead eyebrow="Per-spin proof" title="The ledger." />
          <Pill tone="live">Live from Arc</Pill>
        </div>
        <div className="mt-10">
          <FairnessLedger />
        </div>
      </section>

      {/* ============================================================================ faq */}
      <section className="mt-20 md:mt-28">
        <div className="grid gap-12 lg:grid-cols-[0.6fr_1.4fr] lg:gap-16">
          <SectionHead eyebrow="Questions" title="The awkward ones." />
          <FaqAccordion items={FAIRNESS_FAQ} />
        </div>
      </section>
      </div>
    </div>
  )
}
