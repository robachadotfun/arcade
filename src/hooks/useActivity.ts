'use client'

import {useEffect, useState} from 'react'
import {usePublicClient} from 'wagmi'
import {parseAbiItem, formatUnits, type Address} from 'viem'
import {resolveMode} from '@/config/mode'
import {ARC_MAINNET_ID, NATIVE_USDC_DECIMALS} from '@/config/network'
import {type ActivityRecord} from '@/lib/activity'
import {assetByAddress, labelFor} from '@/config/rewards'
import {MACHINES, RARITY_LABEL, RARITY_ORDER} from '@/config/machines'

/**
 * Reads Arcade activity.
 *
 * Pulls `SpinSettled` and `SpinRequested` logs from the machine manager over RPC. That is
 * adequate for an MVP with a bounded lookback, and it is explicitly *not* adequate for a busy
 * production deployment — the `ActivitySource` interface in `lib/activity.ts` exists so a real
 * indexer can replace this without touching any UI.
 *
 * Errors are surfaced rather than swallowed: an RPC failure shows as an error state, never
 * as "no activity", because those two mean very different things to someone checking
 * whether their spin landed.
 */

const SPIN_SETTLED = parseAbiItem(
  'event SpinSettled(uint256 indexed spinId, address indexed player, uint64 indexed machineId, address rewardToken, uint256 rewardAmount, uint256 randomWord, uint8 rarity, bool pushDelivered)',
)

const SPIN_REQUESTED = parseAbiItem(
  'event SpinRequested(uint256 indexed spinId, address indexed player, uint64 indexed machineId, uint32 machineVersion, uint256 pricePaid, uint256 randomnessRequestId)',
)

/**
 * The largest block range Arc's RPC will accept for a single `eth_getLogs`.
 *
 * Probed directly against `rpc.mainnet.arc.io`: 10,000 blocks is rejected with "requested
 * range too large", 5,000 is accepted. Asking for more does not degrade — it fails the whole
 * request, which previously took the activity tape, the fairness ledger and My Arcade down
 * together on any real deployment.
 */
const MAX_LOG_RANGE = 5_000n

/**
 * How many chunks back to walk before giving up.
 *
 * Arc produces sub-second blocks (~0.53s), so 6 × 5,000 is roughly the last four hours. The
 * scan runs newest-first and stops as soon as it has enough rows, so a busy deployment costs
 * one round trip and a quiet one costs at most six.
 *
 * This is a budget, not a lookback target: every chunk is a request against a public endpoint
 * shared by every visitor, and the tape is a recent-activity view, not an archive.
 *
 * This is the honest ceiling of an RPC-only reader. `ActivitySource` in `lib/activity.ts`
 * exists so a real indexer can replace it without touching any UI.
 */
const MAX_CHUNKS = 6

type State = {
  records: ActivityRecord[]
  loading: boolean
  error: string | null
}

function machineNameFor(machineId: bigint): {slug: string; name: string} {
  const match = MACHINES.find((m) => m.onchainId !== null && BigInt(m.onchainId) === machineId)
  if (match) return {slug: match.slug, name: match.name}
  return {slug: 'unknown', name: `Machine ${machineId.toString()}`}
}

const NO_RECORDS: ActivityRecord[] = []

/**
 * One activity read, shared by every component on the page.
 *
 * The homepage mounts both the leaderboard and the activity tape, and each used to run its
 * own chunked scan — up to twelve `eth_getLogs` calls for one page load, against a public
 * endpoint shared by every visitor. That is what rate-limited the tape into an error box.
 *
 * Callers now share a single in-flight request per (deployment, player). A caller wanting
 * more rows than the cached read covers triggers a fresh one; everyone else reuses it and
 * slices locally, which is what they were doing with the result anyway.
 */
type ActivityCacheEntry = {
  limit: number
  fetchedAt: number
  records: ActivityRecord[] | null
  inFlight: Promise<ActivityRecord[]> | null
}

const activityCache = new Map<string, ActivityCacheEntry>()

/** Long enough to cover a page's components mounting, far shorter than the 45s poll. */
const SHARED_FRESH_MS = 30_000

async function sharedActivity(
  key: string,
  limit: number,
  fetcher: () => Promise<ActivityRecord[]>,
): Promise<ActivityRecord[]> {
  const entry = activityCache.get(key)
  const covers = entry !== undefined && entry.limit >= limit

  if (covers && entry.records && Date.now() - entry.fetchedAt < SHARED_FRESH_MS) {
    return entry.records
  }
  if (covers && entry.inFlight) return entry.inFlight

  const inFlight = fetcher()
  activityCache.set(key, {limit, fetchedAt: Date.now(), records: null, inFlight})

  try {
    const records = await inFlight
    activityCache.set(key, {limit, fetchedAt: Date.now(), records, inFlight: null})
    return records
  } catch (err) {
    // A failed read must not be cached as an answer, or every later caller inherits it.
    activityCache.delete(key)
    throw err
  }
}

/**
 * Turns a transport failure into something a player can act on.
 *
 * viem's message carries the endpoint URL, the full request body and its own version. That
 * is the right amount of detail in a terminal and the wrong amount on a page someone is
 * trying to read their spin off — it looks like the site broke open. The distinction that
 * actually matters to a reader is kept: this is a failure to read, not an empty tape.
 */
function describeReadFailure(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/\b429\b|rate limit|exceeds defined limit/i.test(raw)) {
    return 'Arc’s public RPC is rate-limiting this page right now. The tape reloads on its own — nothing has been lost.'
  }
  return 'Could not reach Arc to read activity. This is a connection problem, not an empty tape.'
}

/**
 * The shape of a decoded log this hook relies on.
 *
 * Fetching two events in one `getLogs` returns a union viem cannot narrow for us, so the
 * fields actually read are named here rather than reaching through `unknown` at each use.
 */
type SpinLog = {
  eventName?: string
  blockNumber: bigint | null
  transactionHash: `0x${string}` | null
  args: Record<string, unknown>
}

export function useActivity({
  limit = 25,
  player,
}: {limit?: number; player?: Address} = {}): State {
  const status = resolveMode()
  const publicClient = usePublicClient()
  const [chainState, setChainState] = useState<State>({
    records: NO_RECORDS,
    loading: true,
    error: null,
  })

  // A primitive fingerprint of the resolved mode, so the effect's dependency list is a set
  // of statically checkable values rather than a freshly-built object each render.
  const managerAddress = status.kind === 'ready' ? status.contracts.machineManager : undefined
  const missingFingerprint = status.kind === 'misconfigured' ? status.missing.join(',') : ''

  useEffect(() => {
    let cancelled = false

    // The misconfigured message is derived below rather than written here, so it cannot go
    // stale relative to the resolved mode.
    if (status.kind !== 'ready') return

    // No client yet: the derived return below already reports this as loading.
    if (!publicClient || !managerAddress) return

    const manager = managerAddress

    async function fetchRecords(): Promise<ActivityRecord[]> {
        const latest = await publicClient!.getBlockNumber()

        const settled: SpinLog[] = []
        const requested: SpinLog[] = []

        // Walk backwards a chunk at a time, newest first. Both events are fetched in ONE
        // request per chunk rather than two — `events` takes an array and the results carry
        // an `eventName` discriminator, which halves the request count for free.
        let toBlock = latest
        for (let chunk = 0; chunk < MAX_CHUNKS; chunk += 1) {
          const fromBlock = toBlock > MAX_LOG_RANGE ? toBlock - MAX_LOG_RANGE : 0n

          const logs = await publicClient!.getLogs({
            address: manager,
            events: [SPIN_SETTLED, SPIN_REQUESTED],
            fromBlock,
            toBlock,
          })

          for (const entry of logs) {
            const log = entry as unknown as SpinLog
            // `events` cannot take an indexed filter the way a single `event` can, so the
            // per-player filter is applied here instead of at the node.
            const who = log.args['player']
            if (player && String(who ?? '').toLowerCase() !== player.toLowerCase()) continue
            if (log.eventName === 'SpinSettled') settled.push(log)
            else if (log.eventName === 'SpinRequested') requested.push(log)
          }

          // Stop as soon as the view has what it can display. Without this a deployment with
          // a handful of spins walked every chunk on every poll — 24 log requests every 20
          // seconds per visitor, which is what got the public RPC to rate-limit us.
          if (settled.length + requested.length >= limit || fromBlock === 0n) break
          toBlock = fromBlock - 1n
        }

        // No cancellation check here: this read is shared, so one component unmounting must
        // not discard a result the others are waiting on. Cancellation is applied where the
        // result reaches state instead.

        // Settled spins carry the outcome; requested-only spins are still pending.
        const settledIds = new Set(
          settled.map((log) => (log as unknown as {args: {spinId: bigint}}).args.spinId.toString()),
        )

        // Timestamps come from the blocks the events landed in. Fetched once per block.
        const blockNumbers = new Set<bigint>()
        for (const log of [...settled, ...requested]) {
          if (log.blockNumber !== null) blockNumbers.add(log.blockNumber)
        }
        const blockTimes = new Map<string, number>()
        await Promise.all(
          [...blockNumbers].map(async (bn) => {
            try {
              const block = await publicClient!.getBlock({blockNumber: bn})
              blockTimes.set(bn.toString(), Number(block.timestamp) * 1000)
            } catch {
              // A missing timestamp is not worth failing the whole view over.
            }
          }),
        )

        const records: ActivityRecord[] = []

        for (const log of settled) {
          const args = (log as unknown as {
            args: {
              spinId: bigint
              player: Address
              machineId: bigint
              rewardToken: Address
              rewardAmount: bigint
              randomWord: bigint
              rarity: number
            }
          }).args
          const asset = assetByAddress(args.rewardToken)
          const machine = machineNameFor(args.machineId)
          const rarityKey = RARITY_ORDER[args.rarity]

          records.push({
            spinId: args.spinId.toString(),
            player: args.player,
            machineSlug: machine.slug,
            machineName: machine.name,
            status: 'settled',
            // Neither the version nor the price paid is in SpinSettled. Left absent rather
            // than guessed; the fairness page reads the spin record for the full detail.
            pricePaid: '—',
            rewardSymbol: asset ? labelFor(asset) : 'UNKNOWN',
            rewardAddress: args.rewardToken,
            rewardAmount: asset
              ? formatUnits(args.rewardAmount, asset.decimals)
              : args.rewardAmount.toString(),
            rarity: rarityKey ? RARITY_LABEL[rarityKey] : undefined,
            settlementTx: log.transactionHash ?? undefined,
            blockNumber: log.blockNumber === null ? undefined : Number(log.blockNumber),
            timestamp: blockTimes.get(log.blockNumber?.toString() ?? '') ?? Date.now(),
            randomWord: args.randomWord.toString(),
          })
        }

        for (const log of requested) {
          const args = (log as unknown as {
            args: {
              spinId: bigint
              player: Address
              machineId: bigint
              machineVersion: number
              pricePaid: bigint
            }
          }).args
          const id = args.spinId.toString()
          if (settledIds.has(id)) continue

          const machine = machineNameFor(args.machineId)
          records.push({
            spinId: id,
            player: args.player,
            machineSlug: machine.slug,
            machineName: machine.name,
            machineVersion: Number(args.machineVersion),
            status: 'pending',
            pricePaid: formatUnits(args.pricePaid, NATIVE_USDC_DECIMALS),
            requestTx: log.transactionHash ?? undefined,
            blockNumber: log.blockNumber === null ? undefined : Number(log.blockNumber),
            timestamp: blockTimes.get(log.blockNumber?.toString() ?? '') ?? Date.now(),
          })
        }

        records.sort((a, b) => b.timestamp - a.timestamp)
        return records
    }

    async function load() {
      try {
        const records = await sharedActivity(`${manager}|${player ?? ''}`, limit, fetchRecords)
        if (cancelled) return
        setChainState({records, loading: false, error: null})
      } catch (err) {
        if (cancelled) return
        // Distinguishing "we could not read" from "nothing happened" is the point.
        setChainState({records: NO_RECORDS, loading: false, error: describeReadFailure(err)})
      }
    }

    void load()
    // 45s rather than 20s. Each poll is up to six log requests plus block timestamps, and a
    // tape that is a few seconds stale is worth far more than one that is rate-limited away.
    const interval = window.setInterval(() => void load(), 45_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [status.kind, managerAddress, missingFingerprint, player, publicClient, limit])

  if (status.kind === 'misconfigured') {
    return {
      records: NO_RECORDS,
      loading: false,
      error: `Arcade is not configured: ${status.missing.join(', ')}`,
    }
  }

  // Still waiting for an RPC client: report loading rather than an empty tape, because
  // "nothing happened" and "we cannot read yet" mean very different things here.
  if (!publicClient || !managerAddress) {
    return {records: NO_RECORDS, loading: true, error: null}
  }

  return chainState.records.length > limit
    ? {...chainState, records: chainState.records.slice(0, limit)}
    : chainState
}

/** The chain id activity links should point at. */
export function useActivityChainId(): number {
  const status = resolveMode()
  return status.kind === 'ready' ? status.chainId : ARC_MAINNET_ID
}
