/**
 * Shared context for the operator CLI.
 *
 * ## The key
 *
 * Every write here needs `ARCADE_OPERATOR_PRIVATE_KEY`, read from the environment and never
 * from an argument, a prompt or a file this repository tracks. It is never logged, never
 * included in an error message, and never written to the seed store. Only the derived address
 * is ever printed, so a pasted transcript cannot leak the key.
 *
 * Put it in `.env.local`, which is gitignored. For anything holding real value, use a signer
 * that never exposes a raw key to a Node process at all — a hardware wallet or a remote
 * signer behind `forge script --ledger` / a KMS. This CLI is honest about being the
 * convenient option, not the safe one.
 */

import {createPublicClient, createWalletClient, http, type Address, type Chain} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {defineChain} from 'viem'

export const ARC_MAINNET_ID = 5042
export const ARC_TESTNET_ID = 5042002

/** Native USDC — the gas asset, paid via msg.value. 18 decimals on Arc, not 6. */
export const NATIVE_USDC_DECIMALS = 18

const nativeCurrency = {name: 'USD Coin', symbol: 'USDC', decimals: NATIVE_USDC_DECIMALS} as const

function arcChain(id: number, name: string, rpc: string): Chain {
  return defineChain({
    id,
    name,
    nativeCurrency,
    rpcUrls: {default: {http: [rpc]}},
  })
}

export type Network = 'mainnet' | 'testnet'

export type OperatorContext = {
  network: Network
  chain: Chain
  publicClient: ReturnType<typeof createPublicClient>
  /** Present only when a key is configured. Reads work without one. */
  walletClient: ReturnType<typeof createWalletClient> | null
  account: Address | null
  contracts: {
    machineManager: Address
    prizeVault: Address
    rewardRegistry: Address
    randomness: Address
    feeRouter: Address
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function requireAddress(name: string): Address {
  const value = process.env[name]
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new ConfigError(
      `${name} is missing or not an address. Set it in .env.local from the deploy output.`,
    )
  }
  return value as Address
}

/**
 * Builds the context.
 *
 * `requireSigner: false` is used by read-only subcommands so an operator can inspect state
 * without putting a key anywhere near the process.
 */
export function loadContext({requireSigner = true}: {requireSigner?: boolean} = {}): OperatorContext {
  const raw = process.env.NEXT_PUBLIC_ARCADE_MODE?.toLowerCase()
  if (raw !== 'mainnet' && raw !== 'testnet') {
    throw new ConfigError(
      'NEXT_PUBLIC_ARCADE_MODE must be "mainnet" or "testnet". There is no demo mode.',
    )
  }
  const network: Network = raw

  const rpc =
    network === 'mainnet'
      ? (process.env.ARC_MAINNET_RPC_URL ?? 'https://rpc.mainnet.arc.io')
      : (process.env.ARC_TESTNET_RPC_URL ?? 'https://rpc.testnet.arc.io')

  const chain =
    network === 'mainnet'
      ? arcChain(ARC_MAINNET_ID, 'Arc', rpc)
      : arcChain(ARC_TESTNET_ID, 'Arc Testnet', rpc)

  const publicClient = createPublicClient({chain, transport: http(rpc, {retryCount: 3})})

  const key = process.env.ARCADE_OPERATOR_PRIVATE_KEY
  let walletClient: OperatorContext['walletClient'] = null
  let account: Address | null = null

  if (key) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      // Deliberately does not echo the value.
      throw new ConfigError(
        'ARCADE_OPERATOR_PRIVATE_KEY is set but is not a 0x-prefixed 32-byte hex key.',
      )
    }
    const signer = privateKeyToAccount(key as `0x${string}`)
    account = signer.address
    walletClient = createWalletClient({account: signer, chain, transport: http(rpc)})
  } else if (requireSigner) {
    throw new ConfigError(
      'ARCADE_OPERATOR_PRIVATE_KEY is not set. This command sends transactions and needs a signer.',
    )
  }

  return {
    network,
    chain,
    publicClient,
    walletClient,
    account,
    contracts: {
      machineManager: requireAddress('NEXT_PUBLIC_ARCADE_MACHINE_MANAGER'),
      prizeVault: requireAddress('NEXT_PUBLIC_ARCADE_PRIZE_VAULT'),
      rewardRegistry: requireAddress('NEXT_PUBLIC_ARCADE_REWARD_REGISTRY'),
      randomness: requireAddress('NEXT_PUBLIC_ARCADE_RANDOMNESS'),
      feeRouter: requireAddress('NEXT_PUBLIC_ARCADE_FEE_ROUTER'),
    },
  }
}

/** Confirms the RPC is actually on the chain we think it is, before any write. */
export async function assertChain(ctx: OperatorContext): Promise<void> {
  const actual = await ctx.publicClient.getChainId()
  if (actual !== ctx.chain.id) {
    throw new ConfigError(
      `RPC reports chain ${actual}, but ${ctx.network} is chain ${ctx.chain.id}. ` +
        'Check ARC_MAINNET_RPC_URL / ARC_TESTNET_RPC_URL.',
    )
  }
}

export function log(message: string): void {
  process.stdout.write(`${message}\n`)
}

export function fail(message: string): never {
  process.stderr.write(`\n${message}\n`)
  process.exit(1)
}
