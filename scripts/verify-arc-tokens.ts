/**
 * verify-arc-tokens.ts
 *
 * Qualifies candidate Arc Mainnet tokens as Arcade reward assets.
 *
 * Nothing here trusts a ticker, a screener listing, or a name. Every claim is
 * re-derived from Arc Mainnet itself over JSON-RPC:
 *
 *   1. contract code exists at the address
 *   2. name() / symbol() / decimals() / totalSupply() read back from the contract
 *   3. a real holder is discovered from live Transfer logs
 *   4. transfer() is executed against live state via an `eth_call` state override,
 *      measuring what actually arrives (fee-on-transfer / blacklist / pause detection)
 *   5. ticker collisions are computed from what the CONTRACTS report, not from labels
 *   6. liquidity / volume / holder / age thresholds are applied
 *
 * Step 4 is the one that matters. Injecting TransferProbe bytecode at a holder's
 * address lets us call transfer() with msg.sender == holder against live state
 * without broadcasting a transaction or moving funds. Read-only, no keys, no cost.
 *
 * Output: scripts/data/arc-token-verified.json — the only file allowed to seed the
 * reward registry.
 *
 * Usage: pnpm verify:tokens
 */

import {readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CANDIDATES_PATH = resolve(HERE, 'data/arc-token-candidates.json')
const PROBE_PATH = resolve(HERE, 'transfer-probe.runtime.json')
const OUT_PATH = resolve(HERE, 'data/arc-token-verified.json')

const RPC_URL = process.env.ARC_MAINNET_RPC_URL ?? 'https://rpc.mainnet.arc.io'
const EXPECTED_CHAIN_ID = 5042

/** Circle USDC ERC-20 interface on Arc — from official Arc documentation. */
const CANONICAL_USDC = '0x3600000000000000000000000000000000000000'

/**
 * Reward-eligibility thresholds. Deliberately conservative. A token failing any
 * check is recorded with its reasons rather than silently dropped, so the report
 * stays auditable.
 */
const ELIGIBILITY = {
  minLiquidityUsd: 50_000,
  minVolume24hUsd: 100_000,
  minHolders: 1_000,
  minAgeDays: 3,
  /** Reject if any amount is skimmed on transfer (basis points). */
  maxTransferFeeBps: 0,
} as const

type Candidate = {
  address: string
  label: string
  ticker: string
  volume24hUsd: number
  liquidityUsd: number
  holders: number
  ageDays: number
  canonical?: string
  researchFlag?: string
}

type TransferBehaviour = {
  tested: boolean
  holderTested: string | null
  amountSent: string | null
  amountReceived: string | null
  feeBps: number | null
  callSucceeded: boolean | null
  returnsBoolTrue: boolean | null
  note: string
}

type Verified = {
  address: string
  onchain: {
    name: string | null
    symbol: string | null
    decimals: number | null
    totalSupply: string | null
    hasCode: boolean
    codeSize: number
  }
  transferBehaviour: TransferBehaviour
  marketSnapshot: {
    volume24hUsd: number
    liquidityUsd: number
    holders: number
    ageDays: number
    source: string
    capturedAt: string
  }
  checks: Record<string, boolean>
  failureReasons: string[]
  eligible: boolean
  tickerCollision: boolean
  researchFlag?: string
}

const SELECTORS = {
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  totalSupply: '0x18160ddd',
  balanceOf: '0x70a08231',
  /** probeTransfer(address,address,uint256) — verified with `cast sig`. */
  probeTransfer: '0xd48dba97',
} as const

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
/** A code-less, balance-less address used as the probe's transfer destination. */
const PROBE_SINK = '0x0000000000000000000000000000000000000001'
const NUL = String.fromCharCode(0)

let rpcId = 1

/** Minimum gap between RPC calls, so a public endpoint does not rate-limit us. */
const RPC_MIN_INTERVAL_MS = 70
const RPC_MAX_ATTEMPTS = 5
let lastRpcAt = 0

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** A JSON-RPC error the node actually returned (e.g. execution reverted). */
class RpcExecutionError extends Error {}

/**
 * Serialised, retrying JSON-RPC call.
 *
 * Transport failures and rate limits are retried with exponential backoff and then
 * rethrown. They are never allowed to masquerade as "this token has no code" —
 * a silent false negative would quietly drop a legitimate reward asset, or worse,
 * let a bad one through because its checks never ran.
 */
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= RPC_MAX_ATTEMPTS; attempt += 1) {
    const wait = lastRpcAt + RPC_MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastRpcAt = Date.now()

    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id: rpcId++, method, params}),
        signal: AbortSignal.timeout(30_000),
      })
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`RPC ${method} HTTP ${res.status}`)
      }
      if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`)

      const json = (await res.json()) as {result?: T; error?: {message: string; code?: number}}
      if (json.error) {
        // -32000..-32099 are execution-level errors: deterministic, not worth retrying.
        const code = json.error.code ?? 0
        const deterministic = code <= -32000 && code > -32100
        const err = deterministic
          ? new RpcExecutionError(`RPC ${method}: ${json.error.message}`)
          : new Error(`RPC ${method}: ${json.error.message}`)
        throw err
      }
      return json.result as T
    } catch (err) {
      if (err instanceof RpcExecutionError) throw err
      lastError = err
      if (attempt < RPC_MAX_ATTEMPTS) await sleep(250 * 2 ** (attempt - 1))
    }
  }

  throw new Error(
    `RPC ${method} failed after ${RPC_MAX_ATTEMPTS} attempts: ` +
      `${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

/**
 * eth_call that yields null for a *contract-level* failure (method missing, reverted)
 * but propagates transport failures, so infrastructure problems cannot be mistaken
 * for a token lacking a method.
 */
async function tryCall(to: string, data: string, overrides?: unknown): Promise<string | null> {
  const params: unknown[] = overrides ? [{to, data}, 'latest', overrides] : [{to, data}, 'latest']
  try {
    return await rpc<string>('eth_call', params)
  } catch (err) {
    if (err instanceof RpcExecutionError) return null
    throw err
  }
}

function decodeString(hex: string | null): string | null {
  if (!hex || hex === '0x') return null
  const body = hex.slice(2)
  // Standard dynamic string: offset | length | data.
  if (body.length >= 128) {
    const len = Number.parseInt(body.slice(64, 128), 16)
    if (Number.isFinite(len) && len > 0 && len <= 256) {
      const decoded = Buffer.from(body.slice(128, 128 + len * 2), 'hex').toString('utf8')
      const cleaned = decoded.split(NUL).join('').trim()
      if (cleaned.length) return cleaned
    }
  }
  // Some older tokens return a fixed bytes32 instead.
  const asBytes32 = Buffer.from(body.slice(0, 64), 'hex').toString('utf8').split(NUL).join('').trim()
  return asBytes32.length ? asBytes32 : null
}

function decodeUint(hex: string | null): bigint | null {
  if (!hex || hex === '0x') return null
  try {
    return BigInt(hex.length > 66 ? `0x${hex.slice(2, 66)}` : hex)
  } catch {
    return null
  }
}

function encodeAddress(addr: string): string {
  return addr.replace(/^0x/, '').toLowerCase().padStart(64, '0')
}

function encodeUint(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

/**
 * Finds an address currently holding a non-zero balance of `token`, by reading
 * recent Transfer events and checking recipients. Needed as msg.sender for the probe.
 *
 * Only code-less accounts are accepted as probe hosts: overriding a live contract's
 * code could change how the token treats it (pool hooks, allowlists) and would make
 * the measurement meaningless.
 */
async function findHolder(token: string, latestBlock: bigint): Promise<string | null> {
  // Arc produces blocks sub-second, so even 400k blocks is a short wall-clock window.
  const windows = [5_000n, 50_000n, 400_000n]

  for (const span of windows) {
    const fromBlock = latestBlock > span ? latestBlock - span : 0n
    let logs: Array<{topics: string[]}> | null = null
    try {
      logs = await rpc<Array<{topics: string[]}>>('eth_getLogs', [
        {
          address: token,
          topics: [TRANSFER_TOPIC],
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${latestBlock.toString(16)}`,
        },
      ])
    } catch (err) {
      // A range that is too wide is an expected node limit; keep trying smaller sets.
      if (err instanceof RpcExecutionError) continue
      throw err
    }
    if (!logs || logs.length === 0) continue

    const seen = new Set<string>()
    const recipients: string[] = []
    for (let i = logs.length - 1; i >= 0 && recipients.length < 24; i -= 1) {
      const topic = logs[i]?.topics?.[2]
      if (!topic) continue
      const addr = `0x${topic.slice(26)}`.toLowerCase()
      if (addr === ZERO_ADDRESS || addr === token.toLowerCase() || seen.has(addr)) continue
      seen.add(addr)
      recipients.push(addr)
    }

    for (const who of recipients) {
      const code = await rpc<string>('eth_getCode', [who, 'latest'])
      if (code && code !== '0x') continue
      const bal = decodeUint(await tryCall(token, SELECTORS.balanceOf + encodeAddress(who)))
      if (bal !== null && bal > 0n) return who
    }
  }
  return null
}

/**
 * Decodes TransferProbe.Result. All six members are static, so a single static
 * tuple return value is encoded as six inline words with no head offset.
 */
function decodeProbeResult(hex: string) {
  const body = hex.replace(/^0x/, '')
  if (body.length < 64 * 6) return null
  const word = (i: number) => BigInt(`0x${body.slice(i * 64, (i + 1) * 64)}`)
  return {
    callSucceeded: word(0) === 1n,
    returnedTrue: word(1) === 1n,
    amountSent: word(2),
    amountReceived: word(3),
    senderBalanceBefore: word(4),
    senderBalanceAfter: word(5),
  }
}

const untested = (holder: string | null, note: string): TransferBehaviour => ({
  tested: false,
  holderTested: holder,
  amountSent: null,
  amountReceived: null,
  feeBps: null,
  callSucceeded: null,
  returnsBoolTrue: null,
  note,
})

async function probeTransferBehaviour(
  token: string,
  probeRuntime: string,
  latestBlock: bigint,
): Promise<TransferBehaviour> {
  const holder = await findHolder(token, latestBlock)
  if (!holder) {
    return untested(null, 'No code-less holder found in the scanned log window — transfer behaviour UNVERIFIED.')
  }

  const balance = decodeUint(await tryCall(token, SELECTORS.balanceOf + encodeAddress(holder))) ?? 0n
  // Send a meaningful slice so a percentage fee is detectable, but never the whole
  // balance — some tokens special-case full-balance transfers.
  const amount = balance / 2n > 0n ? balance / 2n : balance
  if (amount === 0n) {
    return untested(holder, 'Holder balance is zero — transfer behaviour UNVERIFIED.')
  }

  const data =
    SELECTORS.probeTransfer + encodeAddress(token) + encodeAddress(PROBE_SINK) + encodeUint(amount)
  const raw = await tryCall(holder, data, {[holder]: {code: probeRuntime}})

  if (!raw) {
    return {
      ...untested(holder, 'Probe eth_call failed outright — token is non-standard or blocks this call path.'),
      tested: true,
      amountSent: amount.toString(),
      callSucceeded: false,
    }
  }

  const result = decodeProbeResult(raw)
  if (!result) {
    return {...untested(holder, 'Probe returned undecodable data.'), tested: true, amountSent: amount.toString()}
  }

  const feeBps =
    result.amountSent > 0n
      ? Number(((result.amountSent - result.amountReceived) * 10_000n) / result.amountSent)
      : null

  let note: string
  if (!result.callSucceeded) {
    note = 'transfer() REVERTED against live state — token restricts transfers (pause / blacklist / hook).'
  } else if (feeBps !== null && feeBps > 0) {
    note = `Fee-on-transfer detected: ${feeBps} bps skimmed. Reward accounting would under-deliver.`
  } else if (!result.returnedTrue) {
    note = 'transfer() succeeded but did not return true — non-standard ERC-20 return value.'
  } else {
    note = 'transfer() moved the full amount and returned true against live mainnet state.'
  }

  return {
    tested: true,
    holderTested: holder,
    amountSent: result.amountSent.toString(),
    amountReceived: result.amountReceived.toString(),
    feeBps,
    callSucceeded: result.callSucceeded,
    returnsBoolTrue: result.returnedTrue,
    note,
  }
}

async function main() {
  const candidatesFile = JSON.parse(readFileSync(CANDIDATES_PATH, 'utf8')) as {
    candidates: Candidate[]
    sources: Array<{name: string; url: string; used: string}>
    discoveredAt: string
  }
  const probe = JSON.parse(readFileSync(PROBE_PATH, 'utf8')) as {deployedBytecode: string}

  process.stdout.write(`Arcade token verification\nRPC: ${RPC_URL}\n`)

  const chainId = Number(BigInt(await rpc<string>('eth_chainId', [])))
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Refusing to verify: RPC reports chain ${chainId}, expected ${EXPECTED_CHAIN_ID} (Arc Mainnet).`,
    )
  }
  const latestBlock = BigInt(await rpc<string>('eth_blockNumber', []))
  process.stdout.write(`Chain ${chainId} @ block ${latestBlock}\n\n`)

  // Sanity-check canonical USDC so a broken or wrong RPC fails loudly and early.
  const usdcSymbol = decodeString(await tryCall(CANONICAL_USDC, SELECTORS.symbol))
  const usdcDecimals = decodeUint(await tryCall(CANONICAL_USDC, SELECTORS.decimals))
  process.stdout.write(`Canonical USDC ${CANONICAL_USDC} -> symbol=${usdcSymbol} decimals=${usdcDecimals}\n\n`)
  if (usdcSymbol !== 'USDC') {
    throw new Error(`Canonical USDC interface did not report symbol USDC (got ${usdcSymbol}). Aborting.`)
  }

  const symbolCounts = new Map<string, number>()
  const results: Verified[] = []

  for (const c of candidatesFile.candidates) {
    const addr = c.address.toLowerCase()
    process.stdout.write(`. ${c.label} (${c.ticker}) ${addr}\n`)

    // Not wrapped in a catch: an RPC failure here must abort the run, never be
    // recorded as "this address has no code".
    const code = await rpc<string>('eth_getCode', [addr, 'latest'])
    const hasCode = Boolean(code) && code !== '0x'
    const codeSize = hasCode ? (code.length - 2) / 2 : 0

    const [nameHex, symbolHex, decimalsHex, supplyHex] = await Promise.all([
      tryCall(addr, SELECTORS.name),
      tryCall(addr, SELECTORS.symbol),
      tryCall(addr, SELECTORS.decimals),
      tryCall(addr, SELECTORS.totalSupply),
    ])

    const name = decodeString(nameHex)
    const symbol = decodeString(symbolHex)
    const decimalsBig = decodeUint(decimalsHex)
    const decimals = decimalsBig === null ? null : Number(decimalsBig)
    const totalSupply = decodeUint(supplyHex)

    if (symbol) {
      const key = symbol.toLowerCase()
      symbolCounts.set(key, (symbolCounts.get(key) ?? 0) + 1)
    }

    const transferBehaviour = hasCode
      ? await probeTransferBehaviour(addr, probe.deployedBytecode, latestBlock)
      : untested(null, 'No contract code at address — nothing to probe.')

    const checks: Record<string, boolean> = {
      hasContractCode: hasCode,
      exposesSymbol: Boolean(symbol),
      exposesName: Boolean(name),
      exposesDecimals: decimals !== null && decimals >= 0 && decimals <= 36,
      hasNonZeroSupply: totalSupply !== null && totalSupply > 0n,
      isNotCanonicalUsdc: addr !== CANONICAL_USDC.toLowerCase(),
      transferVerified: transferBehaviour.tested && transferBehaviour.callSucceeded === true,
      noTransferFee:
        transferBehaviour.feeBps !== null && transferBehaviour.feeBps <= ELIGIBILITY.maxTransferFeeBps,
      standardBoolReturn: transferBehaviour.returnsBoolTrue === true,
      meetsLiquidity: c.liquidityUsd >= ELIGIBILITY.minLiquidityUsd,
      meetsVolume: c.volume24hUsd >= ELIGIBILITY.minVolume24hUsd,
      meetsHolders: c.holders >= ELIGIBILITY.minHolders,
      meetsAge: c.ageDays >= ELIGIBILITY.minAgeDays,
    }

    const failureReasons = Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([key]) => key)
    if (c.researchFlag) failureReasons.push('researchFlag')

    results.push({
      address: addr,
      onchain: {name, symbol, decimals, totalSupply: totalSupply?.toString() ?? null, hasCode, codeSize},
      transferBehaviour,
      marketSnapshot: {
        volume24hUsd: c.volume24hUsd,
        liquidityUsd: c.liquidityUsd,
        holders: c.holders,
        ageDays: c.ageDays,
        source: 'https://www.arcscreener.live/',
        capturedAt: candidatesFile.discoveredAt,
      },
      checks,
      failureReasons,
      eligible: false, // resolved below, once collisions are known
      tickerCollision: false,
      ...(c.researchFlag ? {researchFlag: c.researchFlag} : {}),
    })
  }

  // Second pass: ticker collisions are only knowable across the whole set.
  for (const r of results) {
    const sym = r.onchain.symbol?.toLowerCase()
    r.tickerCollision = Boolean(sym) && (symbolCounts.get(sym as string) ?? 0) > 1
    if (r.tickerCollision) r.failureReasons.push('tickerCollision')
    r.eligible = r.failureReasons.length === 0
  }

  const eligible = results.filter((r) => r.eligible)
  const rejected = results.filter((r) => !r.eligible)

  const out = {
    note:
      'Produced by scripts/verify-arc-tokens.ts. Every onchain field was read from Arc Mainnet at the block below. ' +
      'marketSnapshot values are a point-in-time third-party snapshot and are NOT used for treasury solvency — reward ' +
      'quantities are explicitly configured per machine version. "eligible" means Arcade verified the token contract ' +
      'and its transfer behaviour; it is NOT an endorsement of the asset or any claim about its value.',
    generatedAt: new Date().toISOString(),
    chainId,
    verifiedAtBlock: latestBlock.toString(),
    rpcUrl: RPC_URL,
    canonicalUsdc: {
      address: CANONICAL_USDC,
      symbol: usdcSymbol,
      decimals: usdcDecimals === null ? null : Number(usdcDecimals),
    },
    eligibilityThresholds: ELIGIBILITY,
    sources: candidatesFile.sources,
    summary: {
      candidates: results.length,
      eligible: eligible.length,
      rejected: rejected.length,
      rejectedReasonTally: rejected
        .flatMap((r) => r.failureReasons)
        .reduce<Record<string, number>>((acc, reason) => {
          acc[reason] = (acc[reason] ?? 0) + 1
          return acc
        }, {}),
    },
    tokens: results.sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        b.marketSnapshot.liquidityUsd - a.marketSnapshot.liquidityUsd,
    ),
  }

  mkdirSync(dirname(OUT_PATH), {recursive: true})
  writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`)

  process.stdout.write(`\n${'='.repeat(70)}\n`)
  process.stdout.write(`eligible: ${eligible.length} / ${results.length}\n`)
  for (const r of eligible) {
    process.stdout.write(
      `  OK   ${(r.onchain.symbol ?? '??').padEnd(12)} ${r.address}  dec=${r.onchain.decimals}\n`,
    )
  }
  process.stdout.write(`\nrejected: ${rejected.length}\n`)
  for (const r of rejected) {
    process.stdout.write(
      `  NO   ${(r.onchain.symbol ?? '??').padEnd(12)} ${r.address}  ${r.failureReasons.join(', ')}\n`,
    )
  }
  process.stdout.write(`\nwrote ${OUT_PATH}\n`)
}

main().catch((err: unknown) => {
  process.stderr.write(`\nverification failed: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
