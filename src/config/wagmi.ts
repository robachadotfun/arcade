import {createStorage, cookieStorage} from 'wagmi'
import {WagmiAdapter} from '@reown/appkit-adapter-wagmi'
import {createAppKit} from '@reown/appkit/react'
import {defineChain as defineAppKitChain} from '@reown/appkit/networks'
import {http} from 'viem'
import {ARC_MAINNET_ID, ARC_TESTNET_ID, arcMainnet, arcTestnet} from './network'
import {rawMode} from './mode'

/**
 * Wagmi configuration, built by Reown AppKit.
 *
 * ## What AppKit is, and what it is not
 *
 * Arcade already used Reown before this: the WalletConnect relay, the project id and the QR
 * modal were all theirs. AppKit is their *interface* layer on top of that — it owns the
 * connect dialog, the network switcher and the wallet catalogue, and it builds the wagmi
 * config itself through `WagmiAdapter` rather than sitting beside one.
 *
 * That last part is why this file no longer calls `createConfig`. The adapter owns the
 * config; `wagmiConfig` below is the one it built, and `AppProviders` passes it to
 * `WagmiProvider` unchanged.
 *
 * ## The version constraint this cost
 *
 * AppKit supports wagmi 2 only — its own documentation says so outright. This project ran
 * wagmi 3, so adopting AppKit meant downgrading. The visible consequence is that `useAccount`
 * replaces wagmi 3's `useConnection` across the app; they return the same fields.
 *
 * Do not "upgrade" wagmi back to 3 without removing AppKit first. The adapter declares
 * `wagmi >=2.19.5`, which wagmi 3 satisfies numerically while saying nothing about wagmi 3's
 * breaking changes, so the package manager will not stop you and the failure will surface at
 * runtime instead.
 *
 * ## Connectors
 *
 * Not listed here any more: AppKit supplies WalletConnect, injected and Coinbase itself, and
 * discovers browser extensions over EIP-6963 on top. That is what makes a desktop extension
 * reachable — the relay alone can only render a QR code, which is what used to be the only
 * option offered.
 */

/**
 * Reown/WalletConnect project id.
 *
 * Public by design: it is inlined into the browser bundle and identifies the project to the
 * relay. It is not a secret, but it is a quota — restrict it to this site's domains in the
 * Reown dashboard, or someone else's traffic lands on your allowance.
 *
 * Committed with an env override for the same reason the deployment manifest is: a build
 * without environment variables still has to work.
 */
const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'c19d39569957d24fa88dfd2c75205606'

/** Used for the connection metadata Reown shows in the wallet's approval screen. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://myarcade.fun'

/**
 * Arc as AppKit describes a network.
 *
 * AppKit works in CAIP identifiers rather than bare chain ids, so each viem chain is wrapped
 * with its namespace. The chain data itself still comes from `network.ts` — the RPC URLs and
 * the 18-decimal native USDC are defined once there and must not be restated here.
 */
const arcMainnetNetwork = defineAppKitChain({
  ...arcMainnet,
  chainNamespace: 'eip155',
  caipNetworkId: `eip155:${ARC_MAINNET_ID}`,
})

const arcTestnetNetwork = defineAppKitChain({
  ...arcTestnet,
  chainNamespace: 'eip155',
  caipNetworkId: `eip155:${ARC_TESTNET_ID}`,
})

const mode = rawMode()

/** Mainnet builds offer mainnet only, so a player cannot land on the wrong network. */
export const networks = (
  mode === 'mainnet' ? [arcMainnetNetwork] : [arcTestnetNetwork, arcMainnetNetwork]
) as [typeof arcMainnetNetwork, ...(typeof arcMainnetNetwork)[]]

/*
 * Arc's public RPC returns -32005 ("Request exceeds defined limit", which is a *rate* limit,
 * not a size one) under modest load. Reads are retried with a real pause rather than hammering
 * through it; set NEXT_PUBLIC_ARC_MAINNET_RPC_URL to a dedicated endpoint for anything with
 * traffic, because no client-side pacing fixes a shared quota.
 */
const transportOptions = {batch: {batchSize: 16, wait: 24}, retryCount: 3, retryDelay: 400}

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId: WALLETCONNECT_PROJECT_ID,
  // SSR-safe: connection state lives in cookies so the server render matches the client.
  ssr: true,
  storage: createStorage({storage: cookieStorage}),
  transports: {
    [ARC_MAINNET_ID]: http(process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL ?? undefined, transportOptions),
    [ARC_TESTNET_ID]: http(process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL ?? undefined, transportOptions),
  },
})

export const wagmiConfig = wagmiAdapter.wagmiConfig

/*
 * Created once, at module scope, and deliberately not guarded on `typeof window`.
 *
 * The guard was tried and it breaks the build: Next prerenders client components on the
 * server, `WalletButton` calls `useAppKit()` while it does, and the hook throws "Please call
 * createAppKit before using useAppKit" — a hook cannot be called conditionally, so the
 * initialisation is what has to be unconditional. AppKit is built for this and takes
 * `ssr: true` on the adapter above.
 *
 * The connect dialog is opened from `WalletButton` through `useAppKit()`, so nothing else has
 * to know this happened.
 */
createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId: WALLETCONNECT_PROJECT_ID,
  // The site is ivory; AppKit defaults to dark.
  themeMode: 'light',
  metadata: {
    name: 'Arcade',
    description: 'An onchain gacha built on Arc. Pay in USDC, spin once, win real tokens.',
    url: SITE_URL,
    icons: [`${SITE_URL}/icon.png`],
  },
  features: {
    // Arcade is a wallet-first product: a player needs a funded Arc wallet to spin at all,
    // so email and social sign-in would offer an account that cannot do anything yet.
    email: false,
    socials: false,
    analytics: true,
  },
})

/** The chain Arcade expects, given the configured mode. */
export const expectedChain = mode === 'mainnet' ? arcMainnet : arcTestnet

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
