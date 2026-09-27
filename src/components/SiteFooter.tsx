import Link from 'next/link'
import {ArcadeLogo} from './ArcadeMark'
import {Label} from './ui/Primitives'
import {resolveMode} from '@/config/mode'
import {explorerUrl} from '@/config/network'
import {ARC_MAINNET_ID} from '@/config/network'
import {ARCADE_TOKEN} from '@/config/token'
import {CopyAddress} from './CopyAddress'

const PLAY_LINKS = [
  {href: '/play', label: 'Play'},
  {href: '/machines', label: 'Machines'},
  {href: '/rewards', label: 'Rewards'},
  {href: '/activity', label: 'Activity'},
  {href: '/fairness', label: 'Fairness'},
  {href: '/faq', label: 'FAQ'},
]

const LEGAL_LINKS = [
  {href: '/token', label: '$ARCADE'},
  {href: '/contracts', label: 'Contracts'},
  {href: '/legal/terms', label: 'Terms'},
  {href: '/legal/privacy', label: 'Privacy'},
  {href: '/legal/risk', label: 'Risk Disclosure'},
  {href: '/legal/responsible-play', label: 'Responsible Play'},
]

export function SiteFooter() {
  const status = resolveMode()
  const contracts = status.kind === 'ready' ? status.contracts : null
  const chainId = status.kind === 'ready' && status.chainId ? status.chainId : ARC_MAINNET_ID

  return (
    <footer className="mt-auto border-t border-hairline bg-paper-deep">
      <div className="shell grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr] md:gap-8">
        <div>
          <Link href="/" className="text-ink" aria-label="Arcade — home">
            <ArcadeLogo />
          </Link>
          <p className="mt-5 max-w-[34ch] text-[0.9375rem] leading-relaxed text-ink-muted">
            An onchain gacha. Pay in USDC, spin once, win tokens actually trading on Arc.
          </p>
          <p className="mt-6 flex items-center gap-2">
            <span aria-hidden="true" className="h-px w-6 bg-hairline-strong" />
            <Label>Built on Arc</Label>
          </p>

          {/*
            The contract address in the footer, on every page.
            It is the value people are sent looking for and the one a lookalike token cannot
            copy, so it should never be more than a scroll away — and it links to /token rather
            than only sitting here, because an address without context invites buying first and
            checking second.
          */}
          <div className="mt-8 border border-hairline bg-paper-raised p-4">
            <Label>$ARCADE contract</Label>
            <CopyAddress address={ARCADE_TOKEN.address} className="mt-2" />
            <p className="mt-3">
              <Link
                href="/token"
                className="text-[0.8125rem] text-ink-muted underline underline-offset-4 hover:text-ink"
              >
                Token details →
              </Link>
            </p>
          </div>
        </div>

        <nav aria-label="Product">
          <Label>Product</Label>
          <ul className="mt-4 flex flex-col gap-2.5">
            {PLAY_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-[0.9375rem] text-ink-muted transition-colors hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Legal and contracts">
          <Label>Transparency</Label>
          <ul className="mt-4 flex flex-col gap-2.5">
            {LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-[0.9375rem] text-ink-muted transition-colors hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            {contracts ? (
              <li>
                <a
                  href={explorerUrl(chainId, 'address', contracts.machineManager)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[0.75rem] text-ink-faint transition-colors hover:text-arc"
                >
                  Machine manager ↗
                </a>
              </li>
            ) : null}
          </ul>
        </nav>
      </div>

      <div className="border-t border-hairline">
        <div className="shell flex flex-col gap-4 py-7 md:flex-row md:items-start md:justify-between">
          <p className="max-w-[72ch] text-[0.75rem] leading-relaxed text-ink-faint">
            Arcade is an independent application built on Arc and is not affiliated with or
            endorsed by Circle or Arc. Spins purchase a randomised outcome; the token you
            receive may be worth less than what you paid. Nothing here is financial advice.
            Contracts in this repository have not been independently audited.
          </p>
          <p className="micro shrink-0 text-ink-faint">
            © {new Date().getFullYear()} Arcade
          </p>
        </div>
      </div>
    </footer>
  )
}
