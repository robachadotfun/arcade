import {defineChain} from 'viem'

/**
 * Arc network definitions.
 *
 * Every value here was verified against official Arc documentation and confirmed live
 * against the RPC endpoints on 2026-09-18:
 *
 *   eth_chainId @ https://rpc.mainnet.arc.io  -> 0x13b2   (5042)
 *   eth_chainId @ https://rpc.testnet.arc.io  -> 0x4cef52 (5042002)
 *
 * Source: https://docs.arc.io/arc/references/rpc-endpoints
 *
 * ## The decimals trap
 *
 * On Arc, USDC exists in two representations with DIFFERENT precision:
 *
 *   - native USDC (the gas asset, `msg.value`) — 18 decimals
 *   - the USDC ERC-20 interface at 0x3600…0000 — 6 decimals
 *
 * Arc's own docs warn against mixing them. Arcade prices spins in the native asset, so
 * all spin prices in this codebase are 18-decimal values. Use
 * {@link NATIVE_USDC_DECIMALS} and {@link ERC20_USDC_DECIMALS} rather than literals.
 */

export const ARC_MAINNET_ID = 5042
export const ARC_TESTNET_ID = 5042002

/** Native USDC — the gas asset paid via `msg.value`. */
export const NATIVE_USDC_DECIMALS = 18
/** The optional USDC ERC-20 interface. A different precision on purpose. */
export const ERC20_USDC_DECIMALS = 6

/**
 * Canonical contract addresses from Arc documentation.
 * https://docs.arc.io/arc/references/contract-addresses
 */
export const ARC_CONTRACTS = {
  /** USDC ERC-20 interface. Same address on mainnet and testnet. */
  usdcErc20: '0x3600000000000000000000000000000000000000',
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  eurc: {
    mainnet: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1',
    testnet: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  },
} as const

const nativeCurrency = {
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: NATIVE_USDC_DECIMALS,
} as const

export const arcMainnet = defineChain({
  id: ARC_MAINNET_ID,
  name: 'Arc',
  nativeCurrency,
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL ?? 'https://rpc.mainnet.arc.io'],
    },
  },
  blockExplorers: {
    default: {name: 'Arc Explorer', url: 'https://explorer.arc.io'},
  },
  contracts: {
    multicall3: {address: ARC_CONTRACTS.multicall3},
  },
})

export const arcTestnet = defineChain({
  id: ARC_TESTNET_ID,
  name: 'Arc Testnet',
  nativeCurrency,
  testnet: true,
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.io'],
      webSocket: ['wss://rpc.testnet.arc.io'],
    },
  },
  blockExplorers: {
    default: {name: 'Arc Testnet Explorer', url: 'https://explorer.testnet.arc.io'},
  },
  contracts: {
    multicall3: {address: ARC_CONTRACTS.multicall3},
  },
})

export const ARC_CHAINS = {
  [ARC_MAINNET_ID]: arcMainnet,
  [ARC_TESTNET_ID]: arcTestnet,
} as const

export type ArcChainId = typeof ARC_MAINNET_ID | typeof ARC_TESTNET_ID

/** Explorer URL builders. Never hand-concatenate these at call sites. */
export function explorerUrl(chainId: number, kind: 'tx' | 'address' | 'block' | 'token', value: string) {
  const chain = ARC_CHAINS[chainId as ArcChainId] ?? arcMainnet
  const base = chain.blockExplorers.default.url.replace(/\/$/, '')
  return `${base}/${kind}/${value}`
}

export function explorerName(chainId: number) {
  return (ARC_CHAINS[chainId as ArcChainId] ?? arcMainnet).blockExplorers.default.name
}
