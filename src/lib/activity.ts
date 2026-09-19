import type {Address, Hex} from 'viem'
import {safeGetItem, safeSetItem, safeRemoveItem} from '@/hooks/useClientState'

/**
 * The shared shape of an Arcade activity record, plus the indexer boundary.
 *
 * ## No invented numbers
 *
 * Activity comes from indexed `SpinSettled` / `SpinRequested` / `SpinRefunded` events. When
 * there are none — a brand-new deployment, which is the honest state of this project — the
 * UI renders an empty state and says so. There is no seeded fake tape anywhere in this
 * codebase, because a fabricated spin count is the single most misleading thing a product
 * like this could show.
 *
 * Demo mode records the spins *you* simulate in this browser, labelled `simulated`, so the
 * tape is exercisable without inventing other people's activity.
 */

export type SpinStatus = 'pending' | 'settled' | 'refunded'

export type ActivityRecord = {
  /** Onchain spin id, or a `demo-` prefixed id in demo mode. */
  spinId: string
  /** True when this record came from a local simulation rather than the chain. */
  simulated: boolean
  player: Address | string
  machineSlug: string
  machineName: string
  machineVersion: number
  status: SpinStatus
  /** Native USDC paid, as a decimal string. */
  pricePaid: string
  rewardSymbol?: string
  rewardAddress?: Address
  /** Reward amount in whole token units, as a decimal string. */
  rewardAmount?: string
  rarity?: string
  requestTx?: Hex
  settlementTx?: Hex
  blockNumber?: number
  timestamp: number
  /** Present once randomness is revealed. */
  randomWord?: string
  configHash?: string
}

/**
 * The indexer interface.
 *
 * Deliberately an interface: the MVP reads events directly over RPC (see
 * `readSpinActivity`), but a production deployment wants a real indexer. Swapping in a
 * subgraph or a custom indexer means implementing this and nothing else.
 */
export type ActivitySource = {
  name: string
  /** Most recent spins, newest first. */
  recent(limit: number): Promise<ActivityRecord[]>
  /** Spins for a single wallet, newest first. */
  forPlayer(player: Address, limit: number): Promise<ActivityRecord[]>
  /** A single spin, for the fairness detail view. */
  bySpinId(spinId: string): Promise<ActivityRecord | null>
}

export const DEMO_ACTIVITY_KEY = 'arcade.demo.activity.v1'
const DEMO_ACTIVITY_LIMIT = 50

/** Shared empty result, so a snapshot read returns a stable reference. */
const NO_RECORDS: ActivityRecord[] = []

/**
 * Parses locally-recorded demo spins.
 *
 * Module-scope and pure so it can back a `useSyncExternalStore` snapshot. Every record is
 * forced to `simulated: true` on read: a tampered local-storage entry must never be able to
 * render a fabricated spin as a real one.
 */
export function parseDemoActivity(raw: string | null): ActivityRecord[] {
  if (!raw) return NO_RECORDS
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return NO_RECORDS
    const records = parsed
      .filter((r): r is ActivityRecord => typeof r === 'object' && r !== null && 'spinId' in r)
      .map((r) => ({...r, simulated: true as const}))
      .sort((a, b) => b.timestamp - a.timestamp)
    return records.length === 0 ? NO_RECORDS : records
  } catch {
    return NO_RECORDS
  }
}

/** Reads locally-recorded demo spins. Returns [] when storage is unavailable. */
export function readDemoActivity(): ActivityRecord[] {
  return parseDemoActivity(safeGetItem(DEMO_ACTIVITY_KEY))
}

/** Appends a demo spin to local history. Silently no-ops if storage is unavailable. */
export function recordDemoActivity(record: ActivityRecord): void {
  const existing = readDemoActivity()
  const next = [{...record, simulated: true as const}, ...existing].slice(0, DEMO_ACTIVITY_LIMIT)
  // Not fatal if this fails: the spin still happened in the UI, it just is not remembered.
  safeSetItem(DEMO_ACTIVITY_KEY, JSON.stringify(next))
}

export function clearDemoActivity(): void {
  safeRemoveItem(DEMO_ACTIVITY_KEY)
}

export const STATUS_LABEL: Record<SpinStatus, string> = {
  pending: 'Pending',
  settled: 'Settled',
  refunded: 'Refunded',
}

export const STATUS_TONE: Record<SpinStatus, 'warn' | 'live' | 'neutral'> = {
  pending: 'warn',
  settled: 'live',
  refunded: 'neutral',
}
