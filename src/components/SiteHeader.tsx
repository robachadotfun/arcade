'use client'

import Link from 'next/link'
import {usePathname} from 'next/navigation'
import {useState} from 'react'
import {ArcadeLogo} from './ArcadeMark'
import {WalletButton} from './WalletButton'
import {Dot, Label} from './ui/Primitives'
import {MODE_LABEL, resolveMode} from '@/config/mode'

const NAV = [
  {href: '/play', label: 'Play'},
  {href: '/machines', label: 'Machines'},
  {href: '/rewards', label: 'Rewards'},
  {href: '/activity', label: 'Activity'},
  {href: '/fairness', label: 'Fairness'},
  {href: '/faq', label: 'FAQ'},
] as const

export function SiteHeader() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const status = resolveMode()

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-paper/85 backdrop-blur-md">
      <div className="shell flex h-16 items-center justify-between gap-6">
        <Link href="/" className="shrink-0 text-ink" aria-label="Arcade — home">
          <ArcadeLogo />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-7 lg:flex">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`relative text-[0.9375rem] transition-colors duration-200 ${
                  active ? 'text-ink' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {item.label}
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-1.5 left-0 h-px w-full bg-ink"
                  />
                ) : null}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-3">
          <NetworkIndicator />
          <WalletButton />
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            className="grid size-9 place-items-center border border-hairline-strong lg:hidden"
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
              {menuOpen ? (
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.3" />
              ) : (
                <path d="M2 5h12M2 11h12" stroke="currentColor" strokeWidth="1.3" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen ? (
        <nav
          id="mobile-nav"
          aria-label="Primary"
          className="border-t border-hairline bg-paper-raised lg:hidden"
        >
          <ul className="shell flex flex-col py-2">
            {NAV.map((item) => {
              const active = pathname === item.href
              return (
                <li key={item.href} className="border-b border-hairline-faint last:border-0">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    // Closed here rather than in an effect on the pathname: the click is the
                    // actual event, and reacting to a route change causes an extra render.
                    onClick={() => setMenuOpen(false)}
                    className={`block py-3.5 text-[1.0625rem] ${active ? 'text-ink' : 'text-ink-muted'}`}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
          <div className="shell pb-4">
            <Label>{MODE_LABEL[status.mode]}</Label>
          </div>
        </nav>
      ) : null}
    </header>
  )
}

/**
 * Network status. In a misconfigured live mode this says so loudly rather than pretending
 * everything is fine — a player must never think they are on mainnet when the app is not.
 */
function NetworkIndicator() {
  const status = resolveMode()

  if (status.kind === 'misconfigured') {
    return (
      <span className="hidden items-center gap-1.5 sm:flex" title={`Missing: ${status.missing.join(', ')}`}>
        <Dot tone="stop" />
        <span className="micro text-signal-stop">Not configured</span>
      </span>
    )
  }

  const tone = status.mode === 'demo' ? 'warn' : 'live'
  return (
    <span className="hidden items-center gap-1.5 sm:flex">
      <Dot tone={tone} pulse={status.mode !== 'demo'} />
      <span className={`micro ${tone === 'warn' ? 'text-signal-warn' : 'text-signal-live'}`}>
        {status.mode === 'demo' ? 'Demo mode' : MODE_LABEL[status.mode]}
      </span>
    </span>
  )
}
