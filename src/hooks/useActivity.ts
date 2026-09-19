'use client'

import {useEffect, useState} from 'react'
import {usePublicClient} from 'wagmi'
import {parseAbiItem, formatUnits, type Address} from 'viem'
import {resolveMode, isLiveMode} from '@/config/mode'
import {ARC_MAINNET_ID, NATIVE_USDC_DECIMALS} from '@/config/network'
import {DEMO_ACTIVITY_KEY, parseDemoActivity, type ActivityRecord} from '@/lib/activity'
import {useLocalStorageValue} from './useClientState'
import {assetByAddress} from '@/config/rewards'
import {MACHINES, RARITY_LABEL, RARITY_ORDER} from '@/config/machines'

/**
 * Reads Arcade activity.
 *
 * In a live mode this pulls `SpinSettled` and `SpinRequested` logs from the machine manager
 * over RPC. That is adequate for an MVP with a bounded lookback, and it is explicitly *not*
 * adequate for a busy production deployment — the `ActivitySource` interface in
 * `lib/activity.ts` exists so a real indexer can replace this without touching any UI.
 *
 * In demo mode it returns the spins simulated in this browser, all flagged `simulated`.
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

/** How far back to scan. Arc produces sub-second blocks, so this is a short window. */
const LOOKBACK_BLOCKS = 200_000n

type State = {
  records: ActivityRecord[]
  loading: boolean
  error: string | null
  /** True when the data is local simulation rather than chain state. */
  simulated: boolean
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
    simulated: false,
  })

  /**
   * Demo records come straight from a storage snapshot rather than being copied into state
   * by an effect. That keeps the tape consistent across tabs for free, and means a spin
   * recorded elsewhere in the app appears without a second render pass.
   */
  const demoRecords = useLocalStorageValue(DEMO_ACTIVITY_KEY, parseDemoActivity, NO_RECORDS)

  // A primitive fingerprint of the resolved mode, so the effect's dependency list is a set
  // of statically checkable values rather than a freshly-built object each render.
  const managerAddress = status.kind === 'ready' ? status.contracts.machineManager : undefined
  const missingFingerprint = status.kind === 'misconfigured' ? status.missing.join(',') : ''

  useEffect(() => {
    let cancelled = false

    // Demo mode reads from the storage snapshot above; there is nothing to fetch.
    if (status.mode === 'demo') return

    // ------------------------------------------------------------- live modes
    if (status.kind !== 'ready' || !isLiveMode(status.mode)) {
      // The misconfigured message is derived below rather than written here, so it cannot
      // go stale relative to the resolved mode.
      return
    }

    // No client yet: the derived return below already reports this as loading.
    if (!publicClient || !managerAddress) return

    const manager = managerAddress

    async function load() {
      try {
        const latest = await publicClient!.getBlockNumber()
        const fromBlock = latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n

        const [settled, requested] = await Promise.all([
          publicClient!.getLogs({
            address: manager,
            event: SPIN_SETTLED,
            args: player ? {player} : undefined,
            fromBlock,
            toBlock: latest,
          }),
          publicClient!.getLogs({
            address: manager,
            event: SPIN_REQUESTED,
            args: player ? {player} : undefined,
            fromBlock,
            toBlock: latest,
          }),
        ])

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
            simulated: false,
            player: args.player,
            machineSlug: machine.slug,
            machineName: machine.name,
            machineVersion: 0,
            status: 'settled',
            pricePaid: '—',
            rewardSymbol: asset?.symbol ?? 'UNKNOWN',
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
            simulated: false,
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
        setChainState({records, loading: false, error: null, simulated: false})
      } catch (err) {
        if (cancelled) return
        setChainState({
          records: NO_RECORDS,
          loading: false,
          // Distinguishing "we could not read" from "nothing happened" is the point.
          error: err instanceof Error ? err.message : 'Could not read activity from Arc.',
          simulated: false,
        })
      }
    }

    void load()
    const interval = window.setInterval(() => void load(), 20_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [status.kind, status.mode, managerAddress, missingFingerprint, player, publicClient])

  if (status.mode === 'demo') {
    return {
      records: demoRecords.length > limit ? demoRecords.slice(0, limit) : demoRecords,
      loading: false,
      error: null,
      simulated: true,
    }
  }

  if (status.kind === 'misconfigured') {
    return {
      records: NO_RECORDS,
      loading: false,
      error: `Arcade is set to ${status.mode} but is missing contract addresses: ${status.missing.join(', ')}`,
      simulated: false,
    }
  }

  // Still waiting for an RPC client: report loading rather than an empty tape, because
  // "nothing happened" and "we cannot read yet" mean very different things here.
  if (!publicClient || !managerAddress) {
    return {records: NO_RECORDS, loading: true, error: null, simulated: false}
  }

  return chainState.records.length > limit
    ? {...chainState, records: chainState.records.slice(0, limit)}
    : chainState
}

/** The chain id activity links should point at. */
export function useActivityChainId(): number {
  const status = resolveMode()
  return status.kind === 'ready' && status.chainId ? status.chainId : ARC_MAINNET_ID
}
