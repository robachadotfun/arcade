import type {Address, Hex} from 'viem'

/**
 * The shared shape of an Arcade activity record, plus the indexer boundary.
 *
 * ## No invented numbers
 *
 * Activity comes from indexed `SpinSettled` / `SpinRequested` / `SpinRefunded` events, and
 * from nowhere else. When there are none — a fresh deployment — the UI renders an empty state
 * and says so. There is no seeded tape, no local simulation and no placeholder history
 * anywhere in this codebase, because a fabricated spin count is the single most misleading
 * thing a product like this could show.
 *
 * An empty tape on a live deployment means nobody has spun yet. That is a fact worth showing
 * accurately rather than papering over.
 */

export type SpinStatus = 'pending' | 'settled' | 'refunded'

export type ActivityRecord = {
  /** Onchain spin id. */
  spinId: string
  player: Address | string
  machineSlug: string
  machineName: string
  /**
   * Machine version, when it is known.
   *
   * `SpinRequested` carries it; `SpinSettled` does not. A settled row read from logs alone
   * therefore has no version, and this is left undefined rather than defaulted to 0 — a spin
   * displayed as "v0" when it ran on v1 is a wrong number, which is worse than no number.
   */
  machineVersion?: number
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
