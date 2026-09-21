/**
 * Shared context for the operator CLI.
 *
 * ## The key
 *
 * Signing material is resolved by `signer.ts` — preferably from an encrypted keystore the
 * operator created themselves with `cast wallet import`, falling back to a raw env key for
 * testnet. Whichever path is used, the key is never logged, never included in an error
 * message, and never written to the seed store. Only the derived address is printed, so a
 * pasted transcript cannot leak it.
 *
 * For a mainnet deployment, prefer a hardware wallet over both: `forge script --ledger` keeps
 * the key on the device, where no software here can reach it.
 */

import {createPublicClient, createWalletClient, http, type Address, type Chain} from 'viem'
import {defineChain} from 'viem'
import {resolveSigner} from './signer'

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
  /** Present only when a signer is configured. Reads work without one. */
  walletClient: ReturnType<typeof createWalletClient> | null
  account: Address | null
  /** How the signer was resolved, for the banner. Never contains key material. */
  signerSource: string | null
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
export async function loadContext({
  requireSigner = true,
}: {requireSigner?: boolean} = {}): Promise<OperatorContext> {
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

  let walletClient: OperatorContext['walletClient'] = null
  let account: Address | null = null
  let signerSource: string | null = null

  const signer = await resolveSigner()
  if (signer) {
    account = signer.account.address
    signerSource = signer.source
    walletClient = createWalletClient({account: signer.account, chain, transport: http(rpc)})
  } else if (requireSigner) {
    throw new ConfigError(
      'This command sends transactions and needs a signer. Configure one of:\n' +
        '  ARCADE_OPERATOR_ACCOUNT    a name under ~/.foundry/keystores (recommended)\n' +
        '  ARCADE_OPERATOR_KEYSTORE   a path to a keystore JSON file\n' +
        '  ARCADE_OPERATOR_PRIVATE_KEY  raw hex — testnet and throwaway keys only\n\n' +
        'Create a keystore without the key ever touching disk in plaintext:\n' +
        '  cast wallet import arcade-operator --interactive',
    )
  }

  return {
    network,
    chain,
    publicClient,
    walletClient,
    account,
    signerSource,
    contracts: {
      machineManager: requireAddress('NEXT_PUBLIC_ARCADE_MACHINE_MANAGER'),
      prizeVault: requireAddress('NEXT_PUBLIC_ARCADE_PRIZE_VAULT'),
      rewardRegistry: requireAddress('NEXT_PUBLIC_ARCADE_REWARD_REGISTRY'),
      randomness: requireAddress('NEXT_PUBLIC_ARCADE_RANDOMNESS'),
      feeRouter: requireAddress('NEXT_PUBLIC_ARCADE_FEE_ROUTER'),
    },
  }
}

/**
 * Confirms the RPC is on the chain we think it is, and that every configured address actually
 * holds a contract there — before any read or write.
 *
 * The second check is for the most likely mistake of all: an address copied with a character
 * missing, or a testnet address in a mainnet config. Without it the first symptom is an opaque
 * `returned no data ("0x")` from whichever read happens to run first.
 */
export async function assertChain(ctx: OperatorContext): Promise<void> {
  const actual = await ctx.publicClient.getChainId()
  if (actual !== ctx.chain.id) {
    throw new ConfigError(
      `RPC reports chain ${actual}, but ${ctx.network} is chain ${ctx.chain.id}. ` +
        'Check ARC_MAINNET_RPC_URL / ARC_TESTNET_RPC_URL.',
    )
  }

  const empty: string[] = []
  for (const [name, address] of Object.entries(ctx.contracts)) {
    const code = await ctx.publicClient.getCode({address})
    if (!code || code === '0x') empty.push(`  ${name.padEnd(16)} ${address}`)
  }
  if (empty.length > 0) {
    throw new ConfigError(
      `No contract code on ${ctx.chain.name} (chain ${ctx.chain.id}) at:\n${empty.join('\n')}\n\n` +
        'Check these against the deploy output — a truncated address, or one from a different\n' +
        'network, is the usual cause.',
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
