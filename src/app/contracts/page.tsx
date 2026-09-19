import type {Metadata} from 'next'
import Link from 'next/link'
import {SectionHead, Label, DataRow, Pill, ExternalLink} from '@/components/ui/Primitives'
import {MediaCredits, EditorialImage} from '@/components/EditorialImage'
import {ArcadeArt} from '@/components/ArcadeArt'
import {resolveMode, modeLabel} from '@/config/mode'
import {explorerUrl, ARC_MAINNET_ID, ARC_CONTRACTS, arcMainnet, arcTestnet} from '@/config/network'

export const metadata: Metadata = {
  title: 'Contracts',
  description:
    'The Arcade contract architecture, deployed addresses, roles, and the Arc network parameters everything runs on.',
}

const ARCHITECTURE = [
  {
    name: 'ArcadeMachineManager',
    role: 'Machines, versioned reward tables, and the spin lifecycle.',
    notes:
      'Freezes price, machine, version and player into each spin. Enforces maximum-liability before accepting one. Settlement is permissionless.',
  },
  {
    name: 'PrizeVault',
    role: 'Custodies reward inventory and enforces solvency.',
    notes:
      'Holds the invariant balance >= reserved for every token. The treasurer can only withdraw unreserved surplus, so a won prize cannot be withdrawn by an administrator.',
  },
  {
    name: 'RewardRegistry',
    role: 'The allowlist of tokens that may be awarded.',
    notes:
      'Asserts symbol and decimals against the token contract at registration. Decimals are immutable afterwards. Guardians can pause a token; only the registry admin can unpause.',
  },
  {
    name: 'CommitRevealRandomness',
    role: 'Verifiable randomness without a VRF.',
    notes:
      'Commitments are published in advance and consumed in strict order. Implements IRandomnessSource so a VRF adapter can replace it without redeploying anything else.',
  },
  {
    name: 'FeeRouter',
    role: 'Splits spin revenue between reward funding and treasury.',
    notes:
      'Accumulates rather than forwarding on receipt, so a failing destination can never make a spin settlement revert. Cannot touch the prize vault.',
  },
]

const ROLES = [
  ['MACHINE_ADMIN', 'Creates and versions machines, sets reward tables. Cannot settle spins.'],
  ['REGISTRY_ADMIN', 'Curates the token allowlist. Cannot move funds.'],
  ['TREASURER', 'Deposits inventory and withdraws only unreserved surplus.'],
  ['RANDOMNESS_OPERATOR', 'Publishes commitments and reveals seeds. Cannot choose outcomes.'],
  ['GUARDIAN', 'Emergency pause only. Cannot unpause, configure, or move funds.'],
]

export default function ContractsPage() {
  const status = resolveMode()
  const chainId = status.kind === 'ready' ? status.chainId : ARC_MAINNET_ID
  const contracts = status.kind === 'ready' ? status.contracts : null
  const deployed = contracts !== null

  return (
    <div className="relative iso-grid">
      <div className="shell relative py-14 md:py-20">
      <SectionHead
        eyebrow="Contracts"
        title={
          <>
            Separated
            <br />
            on purpose.
          </>
        }
        lede="Configuration, inventory, randomness and settlement are four different contracts with four different role sets. That separation is what makes the system auditable."
      />

      <ArcadeArt
        name="network-arc"
        className="mx-auto mt-12 max-w-[50rem]"
        sizes="(min-width: 1024px) 50rem, 100vw"
      />

      {/* ============================================================= deployed addresses */}
      <section className="mt-14">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <Label>Deployed addresses</Label>
          <Pill tone={deployed ? 'live' : 'warn'}>{modeLabel(status.mode)}</Pill>
        </div>

        {deployed && contracts ? (
          <dl className="mt-5 max-w-[46rem] divide-y divide-hairline-faint border-y border-hairline-faint">
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
          <div className="mt-5 max-w-[46rem] border border-hairline bg-paper-deep/50 p-6">
            <p className="text-[0.9375rem] leading-relaxed text-ink-soft">
              Nothing is deployed for this build, so there are no addresses to publish — and this
              page shows that rather than filling the table with placeholders that look real.
            </p>
            <p className="mt-4 text-[0.8125rem] leading-relaxed text-ink-faint">
              Deploy with{' '}
              <code className="font-mono">
                forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_TESTNET_RPC_URL --broadcast
              </code>
              , then set <code className="font-mono">NEXT_PUBLIC_ARCADE_*</code> in your
              environment. If a live mode is selected without those addresses, Arcade refuses to
              offer spins rather than silently simulating them.
            </p>
          </div>
        )}
      </section>

      {/* ================================================================== architecture */}
      <section className="mt-20">
        <SectionHead eyebrow="Architecture" title="Five contracts." />
        <div className="mt-10 flex flex-col gap-px bg-hairline">
          {ARCHITECTURE.map((item) => (
            <article key={item.name} className="bg-paper-raised p-5 md:grid md:grid-cols-[16rem_1fr] md:gap-8 md:p-6">
              <div>
                <h3 className="font-mono text-[0.9375rem] text-ink">{item.name}</h3>
                <p className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-muted">{item.role}</p>
              </div>
              <p className="mt-3 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-soft md:mt-0">
                {item.notes}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ========================================================================= roles */}
      <ArcadeArt
        name="treasury"
        className="mt-20 max-w-[34rem]"
        sizes="(min-width: 1024px) 34rem, 100vw"
        caption="Revenue and prize inventory are separate pools with separate rules."
      />

      <section className="mt-20 grid gap-12 md:grid-cols-2 md:gap-16">
        <div>
          <Label>Roles</Label>
          <dl className="mt-5 divide-y divide-hairline-faint border-y border-hairline-faint">
            {ROLES.map(([role, description]) => (
              <div key={role} className="py-3.5">
                <dt className="font-mono text-[0.8125rem] text-ink">{role}</dt>
                <dd className="mt-1.5 text-[0.875rem] leading-relaxed text-ink-muted">
                  {description}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 max-w-[52ch] text-[0.8125rem] leading-relaxed text-ink-faint">
            No role can alter a settled outcome. Pausing stops new spins and never strands one in
            flight. A production deployment should hold the top-level admin role in a multisig and
            split the others across separate signers.
          </p>
        </div>

        <div>
          <Label>Arc network parameters</Label>
          <dl className="mt-5 divide-y divide-hairline-faint border-y border-hairline-faint">
            <DataRow label="Mainnet chain ID" value={String(arcMainnet.id)} mono />
            <DataRow label="Mainnet RPC" value={arcMainnet.rpcUrls.default.http[0] ?? '—'} mono />
            <DataRow label="Testnet chain ID" value={String(arcTestnet.id)} mono />
            <DataRow label="Testnet RPC" value={arcTestnet.rpcUrls.default.http[0] ?? '—'} mono />
            <DataRow label="Native asset" value="USDC — 18 decimals" />
            <DataRow label="USDC ERC-20" value={`${ARC_CONTRACTS.usdcErc20} — 6 decimals`} mono />
            <DataRow label="Multicall3" value={ARC_CONTRACTS.multicall3} mono />
          </dl>
          <div className="mt-5 border border-signal-warn/30 bg-signal-warn/4 p-4">
            <Label className="text-signal-warn">Decimals hazard</Label>
            <p className="mt-2 max-w-[52ch] text-[0.875rem] leading-relaxed text-ink-soft">
              Native USDC on Arc uses 18 decimals; the USDC ERC-20 interface uses 6. Arcade prices
              spins in the native asset, so every spin price in this codebase is an 18-decimal
              value. Mixing the two is a documented Arc footgun.
            </p>
          </div>
        </div>
      </section>

      {/* ======================================================================== audit */}
      <section className="mt-20 max-w-[62rem] border border-hairline bg-paper-deep/40 p-6 md:p-8">
        <Label>Audit status</Label>
        <h2 className="mt-4 font-display text-title text-ink">Not audited.</h2>
        <p className="mt-5 max-w-[64ch] text-[1.0625rem] leading-relaxed text-ink-soft">
          These contracts have not been reviewed by an independent security firm. They ship with
          61 unit, fuzz and invariant tests, including a solvency invariant driven through
          thousands of randomised call sequences covering concurrent spins, abandoned randomness,
          hostile tokens and adversarial treasury withdrawals.
        </p>
        <p className="mt-4 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted">
          That is meaningful evidence and it is not an audit. Anyone considering a production
          deployment should commission one, and should read the security assumptions section of
          the repository README first.
        </p>
        <p className="mt-6">
          <Link
            href="/fairness"
            className="text-[0.9375rem] text-arc underline decoration-arc/25 underline-offset-[3px] hover:decoration-arc"
          >
            What the randomness design does and does not guarantee
          </Link>
        </p>
      </section>

      <EditorialImage
        name="architecture-curve"
        alt="The ribbed white interior vault of the Oculus transit hall, its thin curved ribs converging toward a long skylight."
        caption="Repetition with no hidden joins: the structure is the proof."
        aspect="21 / 9"
        className="mt-20"
        sizes="100vw"
      />

      {/* ================================================================ media credits */}
      <section className="mt-20 max-w-[46rem]">
        <Label>Photography credits</Label>
        <p className="mt-3 text-[0.875rem] leading-relaxed text-ink-muted">
          Photographs used as editorial accents. Licences and author credits are read from the
          source API at download time rather than transcribed, and recorded in{' '}
          <code className="font-mono text-[0.8125rem]">public/media/media-attribution.json</code>.
        </p>
        <MediaCredits className="mt-5" />
      </section>
      </div>
    </div>
  )
}
