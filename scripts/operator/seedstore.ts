/**
 * The randomness seed store.
 *
 * ## What this holds and why losing it is expensive
 *
 * Commit–reveal means the operator publishes `keccak256(seed, salt)` *before* a spin exists,
 * and later reveals the pre-image. This file is where those pre-images live between the two.
 *
 * If it is lost, every commitment that has not yet been revealed becomes unrevealable. The
 * spins that consume them cannot settle, and after the reveal window each one is refunded to
 * the player with a penalty slashed from the operator bond — which is the system behaving
 * correctly, and expensive. **Back it up, and keep the backup as carefully as the key.**
 *
 * If it leaks *before* the matching spins resolve, whoever has it can predict those outcomes.
 * They still cannot change one — the anchor blockhash is mixed in at reveal time and did not
 * exist at commit time — but foreknowledge is enough to decide when to play. The file is
 * written 0600 and belongs nowhere near version control.
 *
 * ## Why entries are keyed by commitment index
 *
 * `publishCommitments` appends to an onchain array, and a request consumes
 * `nextCommitmentIndex++`. So index is the only durable link between an onchain request and
 * the pre-image that satisfies it. The store records the index each pair landed at, which the
 * publish step learns from the `CommitmentsPublished` event rather than assuming.
 */

import {randomBytes} from 'node:crypto'
import {readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {keccak256, encodeAbiParameters, type Hex} from 'viem'

const HERE = dirname(fileURLToPath(import.meta.url))

export type SeedEntry = {
  seed: Hex
  salt: Hex
  commitment: Hex
  /** Onchain commitment index, once published. Null while the pair is only local. */
  index: number | null
  /** Request id this pair was revealed for, once revealed. */
  revealedFor: number | null
  createdAt: string
}

type StoreFile = {
  /** Guards against pointing a mainnet daemon at a testnet store, which would fail every reveal. */
  chainId: number
  randomness: string
  entries: SeedEntry[]
}

/**
 * The commitment exactly as the contract computes it:
 * `keccak256(abi.encode(seed, salt))` over two bytes32 values.
 */
export function commitmentFor(seed: Hex, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters([{type: 'bytes32'}, {type: 'bytes32'}], [seed, salt]),
  )
}

export function storePath(chainId: number, randomness: string): string {
  return resolve(HERE, `../data/seeds/${chainId}-${randomness.toLowerCase()}.json`)
}

export function loadStore(chainId: number, randomness: string): StoreFile {
  const path = storePath(chainId, randomness)
  if (!existsSync(path)) {
    return {chainId, randomness: randomness.toLowerCase(), entries: []}
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoreFile
  if (parsed.chainId !== chainId || parsed.randomness !== randomness.toLowerCase()) {
    throw new Error(
      `Seed store at ${path} belongs to chain ${parsed.chainId} / ${parsed.randomness}. Refusing to use it.`,
    )
  }
  return parsed
}

export function saveStore(store: StoreFile): void {
  const path = storePath(store.chainId, store.randomness)
  mkdirSync(dirname(path), {recursive: true})
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, {mode: 0o600})
  // Re-assert the mode: writeFileSync's mode only applies when creating the file.
  chmodSync(path, 0o600)
}

/** Generates `count` fresh pairs with CSPRNG bytes and appends them, unpublished. */
export function generatePairs(store: StoreFile, count: number): SeedEntry[] {
  const created: SeedEntry[] = []
  for (let i = 0; i < count; i += 1) {
    const seed = `0x${randomBytes(32).toString('hex')}` as Hex
    const salt = `0x${randomBytes(32).toString('hex')}` as Hex
    const entry: SeedEntry = {
      seed,
      salt,
      commitment: commitmentFor(seed, salt),
      index: null,
      revealedFor: null,
      createdAt: new Date().toISOString(),
    }
    store.entries.push(entry)
    created.push(entry)
  }
  return created
}

export function unpublished(store: StoreFile): SeedEntry[] {
  return store.entries.filter((e) => e.index === null)
}

export function byIndex(store: StoreFile, index: number): SeedEntry | undefined {
  return store.entries.find((e) => e.index === index)
}

export type {StoreFile}
