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
 * Arc produces sub-second blocks, so 12 × 5,000 is roughly the last few hours. The scan runs
 * newest-first and stops as soon as it has enough rows, so a busy deployment usually costs
 * one round trip and a quiet one costs the full walk.
 *
 * This is the honest ceiling of an RPC-only reader. `ActivitySource` in `lib/activity.ts`
 * exists so a real indexer can replace it without touching any UI.
 */
const MAX_CHUNKS = 12

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

    async function load() {
      try {
        const latest = await publicClient!.getBlockNumber()

        const settled: Awaited<ReturnType<typeof publicClient.getLogs>> = []
        const requested: Awaited<ReturnType<typeof publicClient.getLogs>> = []

        // Walk backwards a chunk at a time, newest first, so the common case costs one
        // request and an early exit rather than the whole window.
        let toBlock = latest
        for (let chunk = 0; chunk < MAX_CHUNKS; chunk += 1) {
          if (cancelled) return
          const fromBlock = toBlock > MAX_LOG_RANGE ? toBlock - MAX_LOG_RANGE : 0n

          const [s, r] = await Promise.all([
            publicClient!.getLogs({
              address: manager,
              event: SPIN_SETTLED,
              args: player ? {player} : undefined,
              fromBlock,
              toBlock,
            }),
            publicClient!.getLogs({
              address: manager,
              event: SPIN_REQUESTED,
              args: player ? {player} : undefined,
              fromBlock,
              toBlock,
            }),
          ])
          settled.push(...s)
          requested.push(...r)

          if (settled.length >= limit || fromBlock === 0n) break
          toBlock = fromBlock - 1n
        }

        if (cancelled) return

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
        setChainState({records, loading: false, error: null})
      } catch (err) {
        if (cancelled) return
        setChainState({
          records: NO_RECORDS,
          loading: false,
          // Distinguishing "we could not read" from "nothing happened" is the point.
          error: err instanceof Error ? err.message : 'Could not read activity from Arc.',
        })
      }
    }

    void load()
    const interval = window.setInterval(() => void load(), 20_000)
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
