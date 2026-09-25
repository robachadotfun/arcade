import type { NextConfig } from 'next'

/**
 * Modules that exist only to satisfy a connector Arcade does not offer.
 *
 * AppKit's wagmi adapter imports the `@wagmi/connectors` barrel, which pulls every connector
 * including Coinbase's `baseAccount`. That reaches `@base-org/account` -> `@coinbase/cdp-sdk`
 * -> `@x402/evm`, and the last of those does not resolve at all: the package's own published
 * files import a subpath that is not there. It fails the build even though no code path in
 * this app can reach it.
 *
 * Arcade offers WalletConnect and browser extensions, so this is dead weight either way.
 * Resolving it to `false` leaves an empty module in its place, which is only safe precisely
 * because nothing calls it — if a Coinbase account connector is ever offered here, this has
 * to be revisited rather than extended.
 *
 * It cannot be avoided by importing a narrower path the way the old WalletConnect-only config
 * did: the barrel import is inside AppKit's adapter, not in this codebase.
 */
const UNRESOLVABLE_UNUSED_MODULES = ['@x402/evm', '@x402/core', '@x402/svm']

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack(config: {resolve: {alias: Record<string, unknown>}}) {
    for (const name of UNRESOLVABLE_UNUSED_MODULES) config.resolve.alias[name] = false
    return config
  },
  turbopack: {
    resolveAlias: Object.fromEntries(
      // Turbopack has no `false`; an empty module is the equivalent.
      UNRESOLVABLE_UNUSED_MODULES.map((name) => [name, {browser: './src/lib/empty-module.ts'}]),
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
