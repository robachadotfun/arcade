import type {Metadata} from 'next'
import Link from 'next/link'
import {DataRow, Label, Pill, SectionHead} from '@/components/ui/Primitives'

export const metadata: Metadata = {
  title: 'For projects',
  description:
    'How a project whose token is a reward on Arcade earns a share of platform revenue: what is paid, what it is paid on, and what it does not buy.',
}

/** Paid per referred spin, in USDC. Published here because a rate nobody can check is a claim. */
const PER_SPIN_USDC = '0.05'

/**
 * Revenue share terms, written to be checkable rather than attractive.
 *
 * ## Why this pays on referred spins and not on spins that land
 *
 * The obvious design is to pay a project when a spin pays out its token. It is the wrong one.
 * Which token a spin lands on is random in proportion to a weight Arcade assigns, so a project
 * with 4% of the table wins 4% of spins whether it promotes Arcade to fifty thousand people or
 * to nobody. A project that did the work would be funding the twenty-three that did not, and
 * every project would have a reason to lobby for a larger weight — which would quietly turn
 * the reward table into a paid listing while /rewards still described it as a curated one.
 *
 * Paying on referred spins fixes all three at once: effort maps to reward, weight stops being
 * worth arguing about, and inclusion stays a separate question from payment.
 *
 * ## Why the rate is a flat number
 *
 * A share of profit would be larger and less believable, because it would require trusting
 * Arcade's accounting for costs nobody outside can see. A fixed amount per spin can be checked
 * against the chain by anyone who can count spins.
 *
 * ## On not printing the current total
 *
 * An earlier version of this page multiplied the rate by the spins settled so far and printed
 * the result. That figure is deliberately not here now — but note it is not concealed either,
 * because it cannot be: spins are onchain and the rate is stated, so anyone who wants the
 * product can have it in a minute. The section below says Arcade is early in plain words
 * instead, which is the same admission without inviting a reader to anchor on one day's number.
 */
export default function PartnersPage() {
  return (
    <div className="relative iso-grid">
      <div className="shell relative py-14 md:py-20">
        <SectionHead
          eyebrow="For projects"
          title={
            <>
              Send us players,
              <br />
              earn on every spin.
            </>
          }
        />

        <p className="mt-8 max-w-[62ch] text-[1.0625rem] leading-relaxed text-ink-muted">
          If your token is a reward on Arcade, you can earn a share of what the platform makes.
          You are paid <strong className="text-ink">per spin you send us</strong> — not per spin
          that happens to pay out your token.
        </p>

        {/* ============================================================== the rate */}
        <section className="mt-12">
          <div className="border border-hairline-strong bg-paper-raised p-6">
            <Label>The rate</Label>
            <p className="mt-3 font-display text-[2rem] leading-none text-ink">
              ${PER_SPIN_USDC}{' '}
              <span className="font-sans text-[0.9375rem] text-ink-muted">per referred spin</span>
            </p>
            <p className="mt-4 max-w-[60ch] text-[0.8125rem] leading-relaxed text-ink-faint">
              A spin costs 2 USDC. Rewards are sized to return roughly 77% of that, and half of
              what is left buys $ARCADE on the open market and burns it. This rate is paid out of
              the remainder, which is why it is five cents and not fifty.
            </p>
          </div>
        </section>

        {/* ============================================================== why referred */}
        <section className="mt-14 border-t border-hairline pt-12">
          <SectionHead eyebrow="The basis" title="Why we pay on referrals, not on outcomes." />

          <p className="mt-6 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            The intuitive design is to pay you when a spin lands on your token. We do not do
            that, and the reason matters if you are deciding whether this is worth your time.
          </p>

          <p className="mt-4 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            Which token a spin pays is random, in proportion to a weight we set. If your token
            holds 4% of the table, it wins about 4% of spins — whether you promote Arcade to
            fifty thousand people or to nobody at all. Under an outcome-based split, a project
            that brought a thousand players would collect on forty of those spins and hand the
            other nine hundred and sixty to everyone else.
          </p>

          <p className="mt-4 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            It would also give every project a reason to argue for a bigger weight, and those
            arguments would eventually win. Paying on referrals keeps the reward table out of
            that conversation entirely.
          </p>
        </section>

        {/* ============================================================== what it is not */}
        <section className="mt-14 border-t border-hairline pt-12">
          <SectionHead eyebrow="Limits" title="What this does not buy." />

          <div className="mt-8 grid gap-px border border-hairline bg-hairline sm:grid-cols-2">
            <div className="bg-paper-raised p-6">
              <Pill tone="arc">Not for sale</Pill>
              <h3 className="mt-4 font-display text-[1.125rem] leading-tight text-ink">
                A place in the reward table
              </h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-muted">
                Admission is decided by the checks published on the rewards page, and the table
                is capped at 24 tiers by the contract — so adding a token now means removing
                one. Paying us nothing and paying us something get a token into that table on
                exactly the same terms: none.
              </p>
            </div>

            <div className="bg-paper-raised p-6">
              <Pill tone="arc">Not for sale</Pill>
              <h3 className="mt-4 font-display text-[1.125rem] leading-tight text-ink">
                A larger share of the odds
              </h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-muted">
                Weights are set to hold the published rarity split and to keep every common
                paying a similar amount in dollars. They are re-checked against live prices and
                changed when they drift. Revenue share is not an input to that.
              </p>
            </div>
          </div>

          <p className="mt-6 max-w-[64ch] text-[0.8125rem] leading-relaxed text-ink-faint">
            A token can also be removed from the table while its project is earning. Beancat was
            removed on 2026-09-29 after its daily volume fell to roughly $530, against published
            thresholds it had passed when it was admitted. Earning revenue would not have changed
            that, and the rule is written down here so it cannot be argued about later.
          </p>
        </section>

        {/* ============================================================== how it works */}
        <section className="mt-14 border-t border-hairline pt-12">
          <SectionHead eyebrow="Mechanics" title="How a spin gets attributed to you." />

          <dl className="mt-8 max-w-[46rem] divide-y divide-hairline-faint border-y border-hairline-faint">
            <DataRow label="Attribution" value="A referral code in the link you share, recorded against the wallet that spins." />
            <DataRow label="Counted from" value="Settled spins onchain. A refunded or unsettled spin earns nothing." />
            <DataRow label="Paid" value="Monthly, in USDC or $ARCADE — your choice." />
            <DataRow label="Published" value="Spins referred, amount owed and the payment transaction, per project." />
          </dl>

          <p className="mt-6 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            Attribution is off-chain today. The spin function takes no referrer argument, so
            putting this onchain needs a new machine contract, and we would rather find out
            whether anyone wants it before writing one. The ledger is published either way, and
            the spin counts in it can be checked against the chain by anyone who disagrees with
            them.
          </p>
        </section>

        {/* ============================================================== honesty about scale */}
        <section className="mt-14 border-t border-hairline pt-12">
          <SectionHead eyebrow="Scale" title="Arcade is early." />

          <p className="mt-6 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            The machine has been live for days, not months, and the rate above is worth what
            that implies. This is a set of published terms fixed in advance, for a platform you
            think will be busier later — not income today.
          </p>

          <p className="mt-4 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            We would rather you took it on that basis than on a projection. Every spin is
            onchain and the rate is five cents, so the arithmetic is available to you now and at
            any point after — which is the reason to agree terms while they are simple.
          </p>
        </section>

        {/* ============================================================== start */}
        <section className="mt-14 border-t border-hairline pt-12">
          <SectionHead eyebrow="Start" title="If your token is already a reward." />
          <p className="mt-6 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            Get in touch and we will issue a referral code. If your token is not in the table
            yet, the checks it has to pass — and the ones other tokens failed and were admitted
            anyway, with the reasons — are all on the rewards page.
          </p>
          <p className="mt-6">
            <Link
              href="/rewards"
              className="text-[0.9375rem] text-ink-muted underline underline-offset-4 hover:text-ink"
            >
              See the reward table and its thresholds →
            </Link>
          </p>
        </section>
      </div>
    </div>
  )
}
