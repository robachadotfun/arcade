import type {Metadata} from 'next'
import Link from 'next/link'
import {ARCADE_TOKEN, ARCADE_POOL_ID, BURN_ADDRESS} from '@/config/token'
import {ARCADE_POOL_KEY} from '../../../scripts/operator/uniswap-v4'
import {resolveMode} from '@/config/mode'
import {explorerUrl} from '@/config/network'
import {expectedChain} from '@/config/wagmi'
import {MACHINES, totalWeight} from '@/config/machines'
import {BurnCounter} from '@/components/BurnCounter'
import {CopyAddress} from '@/components/CopyAddress'
import {DataRow, ExternalLink, Label, Pill, SectionHead} from '@/components/ui/Primitives'

export const metadata: Metadata = {
  title: '$ARCADE',
  description:
    'The $ARCADE token: contract address, supply, where it trades, what it does on the platform, and how much has been bought back and removed from circulation.',
}

/**
 * Everything about $ARCADE in one place, stated so it can be checked.
 *
 * The token was previously visible only in fragments — a line in the reward table, an address
 * inside the payment notice, a burn counter on the homepage. Anyone trying to answer "what is
 * this token and where does it trade" had to assemble it themselves, and the contract address
 * is the one value people actively hunt for.
 *
 * Two rules this page follows, both of which cost it some polish.
 *
 * The pool is described by its key, not just its id. A Uniswap v4 pool has no address, so a
 * bare id cannot be looked up on an explorer the way an ERC-20 can — publishing the currencies,
 * fee, tick spacing and hook is what makes the id reproducible by anyone who wants to derive
 * it themselves. Those values are imported from the same module the buyback uses, so this page
 * cannot drift from what the operator actually trades against.
 *
 * And nothing here claims utility the contracts do not have. $ARCADE is a reward today and a
 * planned payment method; the page says exactly that, with the odds it is actually paid at.
 */
export default function TokenPage() {
  const status = resolveMode()
  const chainId = status.kind === 'ready' ? status.chainId : expectedChain.id

  // The odds $ARCADE is actually paid at, read from the live machine table rather than typed.
  const discovery = MACHINES.find((m) => m.slug === 'discovery')
  const arcadeWeight = discovery?.tiers
    .filter((t) => t.token.toLowerCase() === ARCADE_TOKEN.address.toLowerCase())
    .reduce((sum, t) => sum + t.weight, 0)
  const arcadeOdds =
    discovery && arcadeWeight ? (arcadeWeight / totalWeight(discovery)) * 100 : null

  return (
    <div className="relative iso-grid">
      <div className="shell relative py-14 md:py-20">
        <SectionHead
          eyebrow="The token"
          title={
            <>
              $ARCADE, and
              <br />
              what it actually does.
            </>
          }
        />

        <p className="mt-8 max-w-[62ch] text-[1.0625rem] leading-relaxed text-ink-muted">
          $ARCADE is the platform&apos;s own token. Today it is something you win — it sits in
          the Discovery reward table like any other asset, funded in the prize vault and paid
          out onchain. Soon it will also be something you spend.
        </p>

        {/* ============================================================== the address */}
        <section className="mt-12">
          <div className="border border-hairline-strong bg-paper-raised p-6">
            <Label>Contract address</Label>
            <CopyAddress address={ARCADE_TOKEN.address} className="mt-3" />
            <p className="mt-4 text-[0.8125rem] leading-relaxed text-ink-faint">
              Check this against the explorer before you buy anything. A token that shares a
              ticker is not the same token, and the address is the only part that cannot be
              imitated.
            </p>
            <p className="mt-3">
              <ExternalLink href={explorerUrl(chainId, 'token', ARCADE_TOKEN.address)}>
                <span className="font-mono text-[0.75rem]">View on the explorer</span>
              </ExternalLink>
            </p>
          </div>
        </section>

        {/* ============================================================== the basics */}
        <section className="mt-14 border-t border-hairline pt-12">
          <SectionHead eyebrow="Details" title="The numbers, as the contract reports them." />
          <dl className="mt-8 max-w-[46rem] divide-y divide-hairline-faint border-y border-hairline-faint">
            <DataRow label="Name" value={ARCADE_TOKEN.name} />
            <DataRow label="Symbol" value={ARCADE_TOKEN.symbol} />
            <DataRow label="Decimals" value={String(ARCADE_TOKEN.decimals)} mono />
            <DataRow label="Total supply" value="1,000,000,000" mono />
            <DataRow label="Network" value={`${expectedChain.name} (chain ${chainId})`} />
            <DataRow
              label="Minting"
              value="Minted once at deploy. Nothing can mint more."
            />
          </dl>
        </section>

        {/* ============================================================== where it trades */}
        <section className="mt-14 border-t border-hairline pt-12">
          <SectionHead eyebrow="Where it trades" title="One pool, on Uniswap v4." />

          <p className="mt-6 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            A v4 pool has no address of its own — it is identified by the hash of its key. So
            the key is published here in full: anyone can hash these values and confirm they
            produce the pool id below, which is the only way to be sure you are looking at the
            same market the buyback buys from.
          </p>

          <dl className="mt-8 max-w-[46rem] divide-y divide-hairline-faint border-y border-hairline-faint">
            <DataRow
              label="Pool id"
              value={<span className="font-mono text-[0.75rem] break-all">{ARCADE_POOL_ID}</span>}
            />
            <DataRow
              label="currency0"
              value={<span className="font-mono text-[0.75rem] break-all">{ARCADE_POOL_KEY.currency0}</span>}
            />
            <DataRow
              label="currency1"
              value={<span className="font-mono text-[0.75rem] break-all">{ARCADE_POOL_KEY.currency1}</span>}
            />
            <DataRow label="Fee" value={`${ARCADE_POOL_KEY.fee / 10_000}%`} mono />
            <DataRow label="Tick spacing" value={String(ARCADE_POOL_KEY.tickSpacing)} mono />
            <DataRow
              label="Hook"
              value={<span className="font-mono text-[0.75rem] break-all">{ARCADE_POOL_KEY.hooks}</span>}
            />
          </dl>

          <p className="mt-5 max-w-[64ch] text-[0.8125rem] leading-relaxed text-ink-faint">
            currency1 is the USDC ERC-20 at 0x3600…0000, which uses 6 decimals — not the
            18-decimal native asset Arc charges gas in. Same money, two precisions.
          </p>
        </section>

        {/* ============================================================== what it does */}
        <section className="mt-14 border-t border-hairline pt-12">
          <SectionHead eyebrow="Utility" title="What it does, and what it does not." />

          <div className="mt-8 grid gap-px border border-hairline bg-hairline sm:grid-cols-2">
            <div className="bg-paper-raised p-6">
              <Pill tone="live">Live now</Pill>
              <h3 className="mt-4 font-display text-[1.125rem] leading-tight text-ink">
                A reward you can win
              </h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-muted">
                $ARCADE is in the Discovery reward table
                {arcadeOdds ? ` and pays on ${arcadeOdds.toFixed(2)}% of spins` : ''}, funded in
                the prize vault like every other reward.
              </p>
              <p className="mt-3">
                <Link
                  href="/rewards"
                  className="text-[0.8125rem] text-ink-muted underline underline-offset-4 hover:text-ink"
                >
                  See the full reward table →
                </Link>
              </p>
            </div>

            <div className="bg-paper-raised p-6">
              <Pill tone="arc">Coming soon</Pill>
              <h3 className="mt-4 font-display text-[1.125rem] leading-tight text-ink">
                A way to pay for spins
              </h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-muted">
                Spins will be payable in $ARCADE. It needs a new machine contract — the live one
                takes payment as the chain&apos;s native asset and cannot be upgraded to accept
                a token. No date, and no discount promised.
              </p>
            </div>
          </div>
        </section>

        {/* ============================================================== buyback */}
        <section className="mt-14 border-t border-hairline pt-12">
          <SectionHead eyebrow="Buyback" title="Half of profit, bought and burned." />

          <p className="mt-6 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            Half of the platform&apos;s realised profit is spent buying $ARCADE on the open
            market and sending it to a burn address. Profit, not revenue — measured from chain
            state after payouts and gas, so a losing run spends nothing. The figure below is
            read live from the burn address.
          </p>

          <p className="mt-4 max-w-[64ch] text-[0.8125rem] leading-relaxed text-ink-faint">
            $ARCADE has no burn function, so the reported total supply does not change. The
            circulating amount does. Tokens go to{' '}
            <span className="font-mono break-all">{BURN_ADDRESS}</span>, an address whose
            private key cannot exist.
          </p>
        </section>
      </div>

      <BurnCounter />
    </div>
  )
}
