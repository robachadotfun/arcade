import type {Metadata} from 'next'
import Link from 'next/link'
import {DataRow, ExternalLink, Label, Pill, SectionHead} from '@/components/ui/Primitives'

export const metadata: Metadata = {
  title: 'NFT Spins',
  description:
    'A pooled NFT machine coming to Arcade. Depositors back an NFT, the backing sets the odds, and every pull settles onchain. Not live yet — this page explains the mechanic before it ships.',
}

/**
 * NFT Spins — announced, not live.
 *
 * ## What this page deliberately does not do
 *
 * It shows no pool statistics. The obvious way to build an announcement page is to lay out the
 * real interface with zeroes and dashes in it, which reads as a machine that exists and happens
 * to be empty. Nothing is deployed, so a "0 NFTs / 0 backing / — depositors" panel would be
 * describing a contract that has not been written.
 *
 * So the page explains the mechanic and says plainly that it is not live. Every number here is
 * a *rule* — the markup, the buyer reward, the weighting formula — not a reading. When the
 * contract exists, live figures replace the copy and are read from it, the way every other
 * number on this site is.
 *
 * The one exception is marked as an example, with arithmetic the reader can redo themselves.
 */

/** Illustrative only. Chosen so the weighting is checkable by hand, not as a forecast. */
const EXAMPLE_ODDS = [
  {backing: '0.05', weight: 20, note: 'Backed cheapest — pulled most often'},
  {backing: '0.50', weight: 2, note: 'Mid-range'},
  {backing: '1.00', weight: 1, note: 'Backed highest — rarest pull'},
] as const

const EXAMPLE_TOTAL = EXAMPLE_ODDS.reduce((sum, row) => sum + row.weight, 0)

/**
 * Collections lined up for launch.
 *
 * Names and slugs were read off OpenSea rather than transcribed from the links. Deliberately
 * no floor prices: they move hourly, and a figure printed here would be a stale claim about
 * someone else's market the moment it is rendered. It is also the wrong number for this
 * machine — odds follow the backing a depositor chooses, not the collection's floor.
 */
const COLLECTIONS = [
  {name: 'AKARII', slug: 'akarii'},
  {name: 'OnchainSharc', slug: 'onchainsharc-791982284'},
  {name: 'Arclings', slug: 'arclingsonarc'},
  {name: 'ARC QUOTRON', slug: 'arcquotron'},
] as const

const STEPS = [
  {
    n: '01',
    title: 'Deposit',
    body: 'Add an ERC-721 to the pool and choose what it is backed at. The backing is yours — you set it, and you can take the NFT back out.',
  },
  {
    n: '02',
    title: 'Backing sets the odds',
    body: 'Weight is one divided by backing, so an NFT backed cheaply is pulled more often than one backed high. Every card publishes its own weight.',
  },
  {
    n: '03',
    title: 'Someone pulls',
    body: 'One pull, one NFT, chosen at random and weighted by backing. The price tracks the pool average plus a markup.',
  },
  {
    n: '04',
    title: 'Settles onchain',
    body: 'Ownership transfers and the fee splits in the same transaction. Nothing is promised off-chain and settled later.',
  },
] as const

export default function NftSpinsPage() {
  return (
    <div className="relative iso-grid">
      <div className="shell relative py-14 md:py-20">
        <div className="flex flex-wrap items-center gap-3">
          <Pill tone="warn">Coming soon</Pill>
          <Label>Not deployed — nothing here can be played yet</Label>
        </div>

        <SectionHead
          className="mt-6"
          eyebrow="NFT Spins"
          title={
            <>
              One pull.
              <br />
              Any NFT in the pool.
            </>
          }
        />

        <p className="mt-8 max-w-[60ch] text-[1.0625rem] leading-relaxed text-ink-muted">
          A second kind of machine, where the inventory is not ours. Anyone can deposit an NFT
          and back it at a price of their choosing. That backing decides how often the machine
          picks it. Pull once, and whatever the machine chooses is yours.
        </p>

        <p className="mt-5 max-w-[60ch] text-[0.9375rem] leading-relaxed text-ink-faint">
          This page exists because the mechanic is worth understanding before it ships, not
          because the machine is waiting behind a button. There is no contract yet, so there are
          no pool figures on this page — when there is one, every number here comes from it.
        </p>

        {/* ============================================================ mechanic */}
        <section className="mt-16 border-t border-hairline pt-12">
          <SectionHead eyebrow="How it will work" title="Four steps, all onchain." />

          <ol className="mt-10 grid gap-px border border-hairline bg-hairline sm:grid-cols-2">
            {STEPS.map((step) => (
              <li key={step.n} className="bg-paper-raised p-6">
                <span
                  aria-hidden="true"
                  className="font-mono text-[0.75rem] text-ink-faint"
                  data-numeric=""
                >
                  {step.n}
                </span>
                <h3 className="mt-3 font-display text-[1.125rem] leading-tight text-ink">
                  {step.title}
                </h3>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ============================================================ the odds */}
        <section className="mt-16 border-t border-hairline pt-12">
          <SectionHead
            eyebrow="The weighting"
            title="Cheaper backing means a likelier pull."
          />

          <p className="mt-6 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            Weight is <code className="font-mono">1 ÷ backing</code>, and an NFT&apos;s chance is
            its weight divided by the total. That is the whole formula. It means the pool
            self-balances: back something high and it is rarely pulled, back it low and it leaves
            quickly.
          </p>

          <div className="mt-8 max-w-[44rem] border border-hairline bg-paper-raised p-6">
            <Label>An example, not a forecast</Label>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-faint">
              Three NFTs, backed as below. Redo the arithmetic yourself — that is the point of
              publishing the formula rather than a probability.
            </p>

            <dl className="mt-5 divide-y divide-hairline-faint border-y border-hairline-faint">
              {EXAMPLE_ODDS.map((row) => (
                <DataRow
                  key={row.backing}
                  label={`Backed at ${row.backing}`}
                  value={
                    <span className="font-mono text-[0.8125rem]" data-numeric="">
                      {((row.weight / EXAMPLE_TOTAL) * 100).toFixed(1)}%
                    </span>
                  }
                />
              ))}
            </dl>

            <p className="mt-4 text-[0.75rem] leading-relaxed text-ink-faint">
              Weights {EXAMPLE_ODDS.map((r) => r.weight).join(' : ')} — total {EXAMPLE_TOTAL}.
            </p>
          </div>
        </section>

        {/* ============================================================ collections */}
        <section className="mt-16 border-t border-hairline pt-12">
          <SectionHead eyebrow="At launch" title="The collections going in." />

          <p className="mt-6 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            Four Arc collections are lined up for the first pool. Each links to its collection
            page so you can look at the art and the market yourself before anything is deposited.
          </p>

          <ul className="mt-8 grid max-w-[44rem] gap-px border border-hairline bg-hairline sm:grid-cols-2">
            {COLLECTIONS.map((c) => (
              <li key={c.slug} className="bg-paper-raised p-5">
                <p className="font-display text-[1.0625rem] leading-tight text-ink">{c.name}</p>
                <p className="mt-2">
                  <ExternalLink href={`https://opensea.io/collection/${c.slug}`}>
                    <span className="font-mono text-[0.6875rem]">View the collection</span>
                  </ExternalLink>
                </p>
              </li>
            ))}
          </ul>

          <p className="mt-6 max-w-[64ch] text-[0.8125rem] leading-relaxed text-ink-faint">
            No floor prices are printed here. They move constantly, so any figure on this page
            would be out of date by the time you read it — and it is the wrong number anyway:
            what a pull costs and how often an NFT is chosen follow the backing its depositor
            set, not what the collection trades at.
          </p>
        </section>

        {/* ============================================================ open questions */}
        <section className="mt-16 border-t border-hairline pt-12">
          <SectionHead eyebrow="Still being decided" title="What is not settled yet." />

          <p className="mt-6 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            Announcing a mechanic is not the same as having finished it. These are open, and
            saying so now is cheaper than walking a number back later.
          </p>

          <dl className="mt-8 max-w-[44rem] divide-y divide-hairline-faint border-y border-hairline-faint">
            <DataRow label="Pull price" value="Pool average plus a markup — not yet fixed" />
            <DataRow label="Fee split" value="A share routes back to buyers — not yet fixed" />
            <DataRow label="Withdrawals" value="Depositors can take their own NFT back out" />
            <DataRow label="Randomness" value="Commit–reveal, as the token machines already use" />
            <DataRow label="Contract" value="Not written" />
          </dl>

          <p className="mt-6 max-w-[64ch] text-[0.8125rem] leading-relaxed text-ink-faint">
            The randomness is the one part already solved: Arc has no VRF, so Arcade publishes a
            hashed seed before a spin and reveals it after. The same mechanism carries over
            unchanged — you can read how it works on the{' '}
            <Link
              href="/fairness"
              className="text-ink-muted underline underline-offset-4 hover:text-ink"
            >
              fairness page
            </Link>
            .
          </p>
        </section>

        {/* ============================================================ meanwhile */}
        <section className="mt-16 border-t border-hairline pt-12">
          <SectionHead eyebrow="Meanwhile" title="The token machines are live." />
          <p className="mt-6 max-w-[60ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            Discovery is running now, pays eight different tokens, and every outcome settles
            onchain in about two seconds.
          </p>
          <p className="mt-6">
            <Link
              href="/play"
              className="border border-ink bg-ink px-5 py-2.5 text-[0.9375rem] text-paper transition-opacity hover:opacity-90"
            >
              Play the live machine
            </Link>
          </p>
        </section>
      </div>
    </div>
  )
}
