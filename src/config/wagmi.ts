import {createConfig, http, createStorage, cookieStorage} from 'wagmi'
import {walletConnect} from '@wagmi/connectors/walletConnect'
import {arcMainnet, arcTestnet} from './network'
import {rawMode} from './mode'

/**
 * Wagmi configuration.
 *
 * ## Connectors
 *
 * WalletConnect (Reown) only. It is wagmi's own first-party connector rather than
 * `@reown/appkit` — the AppKit wagmi adapter declares `wagmi >=2.19.5`, which this project's
 * wagmi 3 satisfies numerically while saying nothing about wagmi 3's breaking changes.
 * `@wagmi/connectors` is pinned to the exact version wagmi resolves, so it cannot drift.
 *
 * Imported from the `./walletConnect` subpath rather than the package barrel on purpose. The
 * barrel re-exports every connector, so a bundler follows `baseAccount` into
 * `@base-org/account` and `@coinbase/cdp-sdk`, which imports a module that does not resolve
 * (`@x402/evm/upto/client`) and breaks the build. Nothing here uses those connectors; the
 * subpath means nothing has to load them.
 *
 * ## Browser extensions are not listed here, and do not need to be
 *
 * There is no `injected` connector in this array on purpose. wagmi discovers extensions over
 * EIP-6963 — `multiInjectedProviderDiscovery` defaults to true — so every installed wallet
 * already appears in `useConnect().connectors` with its own name and icon, deduplicated by
 * the wallet itself. Adding `injected()` on top would list a generic duplicate of whichever
 * extension happens to own `window.ethereum`.
 *
 * This is worth stating because the previous note here claimed the opposite: that removing
 * `injected` meant extensions went "through Reown's modal like any other wallet". They cannot.
 * WalletConnect is a relay between two separate devices, so on desktop it can only render a
 * QR code — an extension in the same browser has no way to answer it. `WalletButton` lists
 * the discovered extensions itself and keeps this connector for phones and for wallets that
 * ship no extension.
 */

/**
 * Null when `NEXT_PUBLIC_ARCADE_MODE` is unset. The wallet UI still has to render something
 * coherent in that state — the operator needs to reach /admin to see what is missing — so an
 * unconfigured build behaves like testnet here. It cannot transact regardless: every spin
 * path is gated on `resolveMode()` returning `ready`, which an unconfigured build never does.
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

const mode = rawMode()

const chains = mode === 'mainnet' ? ([arcMainnet] as const) : ([arcTestnet, arcMainnet] as const)

export const wagmiConfig = createConfig({
  chains,
  /*
   * Browser only. WalletConnect's provider reaches for indexedDB as it initialises, which
   * does not exist while Next prerenders — it logged `ReferenceError: indexedDB is not
   * defined` during the static build. No connection can happen during SSR anyway, so the
   * server simply has no connectors.
   *
   * Safe for hydration because WalletButton renders a disabled shell until it has mounted,
   * so the server and client markup agree regardless.
   */
  connectors:
    typeof window === 'undefined'
      ? []
      : [
          walletConnect({
            projectId: WALLETCONNECT_PROJECT_ID,
            showQrModal: true,
            // The site is ivory; Reown's modal defaults to dark. Only themeMode is set —
            // the CSS variable names for deeper theming differ between the modal versions
            // Reown has shipped, and a wrong key fails silently.
            qrModalOptions: {themeMode: 'light'},
            metadata: {
              name: 'Arcade',
              description:
                'An onchain gacha built on Arc. Pay in USDC, spin once, win real tokens.',
              url: SITE_URL,
              icons: [`${SITE_URL}/icon.png`],
            },
          }),
        ],
  // SSR-safe: state lives in cookies so the server render matches the client.
  ssr: true,
  storage: createStorage({storage: cookieStorage}),
  transports: {
    // Arc's public RPC returns -32005 ("Request exceeds defined limit", which is a *rate*
    // limit, not a size one) under modest load. Reads are retried with a real pause rather
    // than hammering through it; set NEXT_PUBLIC_ARC_MAINNET_RPC_URL to a dedicated endpoint
    // for anything with traffic, because no client-side pacing fixes a shared quota.
    [arcMainnet.id]: http(process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL ?? undefined, {
      batch: {batchSize: 16, wait: 24},
      retryCount: 3,
      retryDelay: 400,
    }),
    [arcTestnet.id]: http(process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL ?? undefined, {
      batch: {batchSize: 16, wait: 24},
      retryCount: 3,
      retryDelay: 400,
    }),
  },
})

/** The chain Arcade expects, given the configured mode. */
export const expectedChain = mode === 'mainnet' ? arcMainnet : arcTestnet

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
