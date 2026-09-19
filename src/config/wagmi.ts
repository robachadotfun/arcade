import {createConfig, http, createStorage, cookieStorage} from 'wagmi'
import {injected} from 'wagmi/connectors'
import {arcMainnet, arcTestnet} from './network'
import {rawMode} from './mode'

/**
 * Wagmi configuration.
 *
 * ## Why not RainbowKit
 *
 * RainbowKit 2.x peers on `wagmi@^2.9`, which is incompatible with wagmi 3. More to the
 * point, its modal carries its own visual identity, and this product's whole premise is a
 * bespoke Arc-native surface. Arcade ships a small accessible connect dialog instead —
 * see `components/WalletButton.tsx` — built on wagmi's own connector APIs.
 *
 * The injected connector covers every EVM browser wallet the user already has. Adding
 * WalletConnect later is a one-line change here plus a project id; it is left out because
 * it needs a third-party relay and a project id that this build does not have.
 */

/**
 * Null when `NEXT_PUBLIC_ARCADE_MODE` is unset. The wallet UI still has to render something
 * coherent in that state — the operator needs to reach /admin to see what is missing — so an
 * unconfigured build behaves like testnet here. It cannot transact regardless: every spin
 * path is gated on `resolveMode()` returning `ready`, which an unconfigured build never does.
 */
const mode = rawMode()

const chains = mode === 'mainnet' ? ([arcMainnet] as const) : ([arcTestnet, arcMainnet] as const)

export const wagmiConfig = createConfig({
  chains,
  connectors: [
    injected({
      shimDisconnect: true,
    }),
  ],
  // SSR-safe: state lives in cookies so the server render matches the client.
  ssr: true,
  storage: createStorage({storage: cookieStorage}),
  transports: {
    [arcMainnet.id]: http(process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL ?? undefined, {
      batch: true,
      retryCount: 2,
    }),
    [arcTestnet.id]: http(process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL ?? undefined, {
      batch: true,
      retryCount: 2,
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
