import type {Metadata, Viewport} from 'next'
import {Fraunces, Inter, IBM_Plex_Mono} from 'next/font/google'
import './globals.css'
import {AppProviders} from '@/components/AppProviders'
import {SiteHeader} from '@/components/SiteHeader'
import {SiteFooter} from '@/components/SiteFooter'
import {ResponsibleNotice} from '@/components/ResponsibleNotice'

/*
  Type pairing: Fraunces for display, Inter for text, IBM Plex Mono for technical labels.
  All three are SIL Open Font License, so nothing here depends on a licence Arcade does not
  hold. Arc's own proprietary typeface is deliberately not used.
*/

// Loaded as a variable font so the SOFT and WONK axes are available to the display type.
// Axes and an explicit weight list are mutually exclusive in next/font.
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  axes: ['SOFT', 'WONK'],
})

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono-stack',
  weight: ['400', '500'],
})

export const metadata: Metadata = {
  title: {
    default: 'Arcade — Play the economic layer',
    template: '%s — Arcade',
  },
  description:
    'An onchain gacha built on Arc. Pay in USDC, spin once, win tokens actually trading on the network. Every spin verifiable onchain.',
  applicationName: 'Arcade',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  openGraph: {
    title: 'Arcade — Play the economic layer',
    description:
      'Pay in USDC. Spin on Arc. Win tokens actually trading on the network. Every spin in the open.',
    type: 'website',
  },
  robots: {index: true, follow: true},
  other: {
    // Stated in the document itself, not only in the footer.
    'arcade:affiliation': 'Independent. Not affiliated with or endorsed by Circle or Arc.',
  },
}

export const viewport: Viewport = {
  themeColor: '#fbf9f4',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${plexMono.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-100 focus:bg-ink focus:px-4 focus:py-2 focus:text-paper focus:label"
        >
          Skip to content
        </a>
        <AppProviders>
          <div className="flex min-h-dvh flex-col">
            <SiteHeader />
            <main id="main" className="flex-1">
              {children}
            </main>
            <SiteFooter />
          </div>
          <ResponsibleNotice />
        </AppProviders>
      </body>
    </html>
  )
}
