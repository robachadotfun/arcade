import type { NextConfig } from 'next'

/**
 * Module specifiers that exist only to satisfy a connector Arcade does not offer.
 *
 * AppKit's wagmi adapter imports the `@wagmi/connectors` barrel, which pulls every connector
 * including Coinbase's `baseAccount`. That reaches `@base-org/account` -> `@coinbase/cdp-sdk`
 * -> the `@x402/*` packages, and those do not resolve at all: the published files import
 * subpaths that are not there. The build fails even though no code path in this app can
 * reach them.
 *
 * Arcade offers WalletConnect and browser extensions, so this is dead weight either way.
 * Resolving each to an empty module is only safe precisely because nothing calls it — if a
 * Coinbase account connector is ever offered here, this has to be revisited rather than
 * extended.
 *
 * It cannot be avoided by importing a narrower path the way the old WalletConnect-only config
 * did: the barrel import is inside AppKit's adapter, not in this codebase.
 *
 * Every specifier is listed in full rather than by package root. Turbopack matches
 * `resolveAlias` keys exactly, so a root alias leaves the subpaths unresolved — which is how
 * this passed a webpack build and still failed the turbopack one that actually ships.
 */
const UNRESOLVABLE_UNUSED_MODULES = [
  '@x402/core/client',
  '@x402/evm',
  '@x402/evm/exact/client',
  '@x402/evm/upto/client',
  '@x402/svm/exact/client',
]

const EMPTY_MODULE = './src/lib/empty-module.cjs'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack(config: {resolve: {alias: Record<string, unknown>}}) {
    for (const name of UNRESOLVABLE_UNUSED_MODULES) config.resolve.alias[name] = false
    return config
  },
  turbopack: {
    // Turbopack has no `false`; an empty module is the equivalent.
    resolveAlias: Object.fromEntries(
      UNRESOLVABLE_UNUSED_MODULES.map((name) => [name, EMPTY_MODULE]),
    ),
  },
  poweredByHeader: false,
  images: {
    // Token logos are fetched from canonical project metadata (often IPFS gateways).
    remotePatterns: [
      { protocol: 'https', hostname: '**.ipfs.w3s.link' },
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: 'cloudflare-ipfs.com' },
      { protocol: 'https', hostname: 'arcscreener.live' },
      { protocol: 'https', hostname: 'www.arcscreener.live' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
