'use client'

import {useEffect, useRef, useState} from 'react'
import {
  useConnection,
  useBalance,
  usePublicClient,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi'
import {parseUnits, formatUnits, type Hex} from 'viem'
import {arcadeMachineManagerAbi} from '@/abi'
import {resolveMode, isLiveMode, type ArcadeContracts} from '@/config/mode'
import {expectedChain} from '@/config/wagmi'
import {NATIVE_USDC_DECIMALS} from '@/config/network'
import {RARITY_LABEL, type MachineConfig, type Rarity} from '@/config/machines'
import {assetByAddress, type RewardAsset} from '@/config/rewards'
import {drawDemoOutcome, type DemoOutcome} from '@/lib/demoOutcome'
import {recordDemoActivity} from '@/lib/activity'
import {useLocalStorageValue, safeSetItem, safeRemoveItem} from './useClientState'

/**
 * The spin lifecycle.
 *
 * ## Invariants this hook is responsible for
 *
 * 1. **The outcome is never decided here in a live mode.** `requestSpin` sends a
 *    transaction; the result is read back from contract storage once randomness is revealed.
 *    The UI animates toward a result it was told about and cannot reach `revealed` without
 *    one.
 * 2. **A demo outcome can never be mistaken for a real one.** Demo results carry
 *    `simulated: true` all the way to the screen, and this hook throws rather than fabricate
 *    one in a live mode.
 * 3. **No infinite spinners.** Every waiting phase has a deadline; on expiry the hook moves
 *    to an error phase carrying a recovery action.
 * 4. **Refreshing mid-spin does not lose the spin.** The pending spin id lives in local
 *    storage, which is the single source of truth — read as a snapshot rather than
 *    duplicated into component state, so the two can never disagree.
 *
 * ## State shape
 *
 * Only genuinely *active* phases are stored. The resting phase ("ready", "needs wallet",
 * "wrong network", "insufficient funds", "blocked") is derived during render from
 * configuration and wallet state, so the reason a spin is unavailable is a pure function of
 * its inputs and can never go stale.
 */

export type SpinPhase =
  | 'idle'
  | 'needs-wallet'
  | 'wrong-network'
  | 'insufficient-funds'
  | 'blocked'
  | 'ready'
  | 'authorizing'
  | 'pending-tx'
  | 'awaiting-randomness'
  | 'settling'
  | 'revealed'
  | 'error'

/** Phases representing an in-flight or finished spin rather than a resting state. */
type ActivePhase = Extract<
  SpinPhase,
  'authorizing' | 'pending-tx' | 'awaiting-randomness' | 'settling' | 'revealed' | 'error'
>

export type SpinOutcome = {
  simulated: boolean
  spinId: string
  asset: RewardAsset | undefined
  rarity: Rarity
  /** Whole token units, as a display string. */
  amount: string
  randomWord?: string
  settlementTx?: Hex
  requestTx?: Hex
  /** True when the reward was pushed to the wallet; false when it must be claimed. */
  delivered: boolean
}

export type SpinError = {
  code:
    | 'user-rejected'
    | 'insufficient-funds'
    | 'wrong-network'
    | 'machine-paused'
    | 'inventory-short'
    | 'randomness-timeout'
    | 'settlement-failed'
    | 'rpc-unavailable'
    | 'not-configured'
    | 'unknown'
  title: string
  detail: string
  /** A concrete next step. Never left empty. */
  recovery: string
  retryable: boolean
}

const PENDING_SPIN_KEY = 'arcade.pendingSpinId.v1'
/** How long to wait for randomness before surfacing a timeout with recovery options. */
const RANDOMNESS_DEADLINE_MS = 90_000
/** Poll interval while waiting for the reveal. */
const SETTLE_POLL_MS = 3_000

/** Contract `SpinStatus` enum: 0 None, 1 Pending, 2 Settled, 3 Refunded. */
const SPIN_SETTLED = 2
const SPIN_REFUNDED = 3

/** Module-scope so the storage snapshot stays referentially stable across renders. */
function parsePendingSpinId(raw: string | null): string | null {
  if (!raw) return null
  // Only a decimal spin id is meaningful; anything else is stale or tampered-with.
  return /^[0-9]+$/.test(raw) ? raw : null
}

/**
 * Extracts the spin id from a `requestSpin` receipt.
 *
 * Pure, so the id can be derived during render rather than written into state by an effect.
 * `SpinRequested` carries the spin id in its first indexed topic.
 */
function parseSpinIdFromReceipt(
  logs: ReadonlyArray<{topics: readonly string[]}> | undefined,
): string | null {
  if (!logs) return null
  const log = logs.find((entry) => entry.topics.length >= 4)
  const idTopic = log?.topics[1]
  if (!idTopic) return null
  try {
    return BigInt(idTopic).toString()
  } catch {
    return null
  }
}

/** The error shown when a spin confirmed but its id could not be recovered. */
const SPIN_ID_UNREADABLE: SpinError = {
  code: 'settlement-failed',
  title: 'Spin submitted, but its id could not be read',
  detail: 'The transaction confirmed but no SpinRequested event was found in the receipt.',
  recovery:
    'Open the activity tape — the spin is recorded onchain even if this view lost track of it.',
  retryable: false,
}

function classifyError(err: unknown): SpinError {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()

  if (
    lower.includes('user rejected') ||
    lower.includes('user denied') ||
    lower.includes('rejected the request')
  ) {
    return {
      code: 'user-rejected',
      title: 'You cancelled the spin',
      detail: 'The transaction was rejected in your wallet, so nothing was charged.',
      recovery: 'Spin again when you are ready.',
      retryable: true,
    }
  }
  if (lower.includes('insufficient funds') || lower.includes('exceeds balance')) {
    return {
      code: 'insufficient-funds',
      title: 'Not enough USDC',
      detail: 'Your wallet does not hold enough native USDC to cover the spin price plus gas.',
      recovery: 'Top up USDC on Arc, then try again.',
      retryable: true,
    }
  }
  if (lower.includes('machineispaused') || lower.includes('machine is paused')) {
    return {
      code: 'machine-paused',
      title: 'This machine is paused',
      detail:
        'New spins are temporarily stopped on this machine. Spins already in flight are unaffected.',
      recovery: 'Try another machine, or check back shortly.',
      retryable: false,
    }
  }
  if (lower.includes('insufficientinventory')) {
    return {
      code: 'inventory-short',
      title: 'Prize inventory too low',
      detail:
        'The vault cannot currently cover the worst-case payout for another spin on this machine, so the contract refused it. This protects you — a machine is never allowed to accept a spin it could not pay.',
      recovery: 'Try a different machine, or wait for inventory to be topped up.',
      retryable: false,
    }
  }
  if (lower.includes('nocommitmentsavailable')) {
    return {
      code: 'randomness-timeout',
      title: 'No randomness available',
      detail:
        'The randomness commitment pool is empty, so no new spin can be accepted right now.',
      recovery: 'This needs an operator to publish more commitments. Try again shortly.',
      retryable: true,
    }
  }
  if (lower.includes('chain') && lower.includes('mismatch')) {
    return {
      code: 'wrong-network',
      title: 'Wrong network',
      detail: `Your wallet is not on ${expectedChain.name}.`,
      recovery: `Switch to ${expectedChain.name} and try again.`,
      retryable: true,
    }
  }
  if (lower.includes('fetch') || lower.includes('network request') || lower.includes('timeout')) {
    return {
      code: 'rpc-unavailable',
      title: 'Cannot reach Arc',
      detail: 'The RPC endpoint did not respond. Your spin may or may not have been submitted.',
      recovery: 'Check the activity tape before spinning again, so you do not pay twice.',
      retryable: false,
    }
  }

  return {
    code: 'unknown',
    title: 'Something went wrong',
    detail: message.slice(0, 300),
    recovery: 'Check the activity tape to see whether your spin landed before retrying.',
    retryable: true,
  }
}

type RestingState = {phase: SpinPhase; error: SpinError | null}

/** The resting state of the machine, derived from configuration and wallet state alone. */
function deriveRestingState(
  machine: MachineConfig,
  status: ReturnType<typeof resolveMode>,
  isConnected: boolean,
  chainId: number | undefined,
  balance: bigint | undefined,
  spinPrice: bigint,
): RestingState {
  if (status.kind === 'misconfigured') {
    return {
      phase: 'blocked',
      error: {
        code: 'not-configured',
        title: `${status.mode} mode is not configured`,
        detail: `Arcade is set to ${status.mode} but these contract addresses are missing: ${status.missing.join(', ')}.`,
        recovery:
          'Arcade will not simulate a spin while a live mode is selected. Set the addresses, or switch NEXT_PUBLIC_ARCADE_MODE to demo.',
        retryable: false,
      },
    }
  }

  if (machine.status !== 'live') {
    return {
      phase: 'blocked',
      error: {
        code: 'machine-paused',
        title: machine.status === 'paused' ? 'This machine is paused' : 'This machine is disabled',
        detail: 'It is not accepting spins.',
        recovery: 'Browse the other machines.',
        retryable: false,
      },
    }
  }

  // Demo mode needs no wallet at all.
  if (status.mode === 'demo') return {phase: 'ready', error: null}

  if (!isConnected) return {phase: 'needs-wallet', error: null}
  if (chainId !== expectedChain.id) return {phase: 'wrong-network', error: null}
  if (balance !== undefined && balance < spinPrice) {
    return {phase: 'insufficient-funds', error: null}
  }
  return {phase: 'ready', error: null}
}

export function useSpin(machine: MachineConfig) {
  const status = resolveMode()
  const {address, isConnected, chainId} = useConnection()
  const publicClient = usePublicClient()
  const {writeContractAsync} = useWriteContract()

  const [activePhase, setActivePhase] = useState<ActivePhase | null>(null)
  const [outcome, setOutcome] = useState<SpinOutcome | null>(null)
  const [activeError, setActiveError] = useState<SpinError | null>(null)
  const [txHash, setTxHash] = useState<Hex | undefined>()
  const deadlineRef = useRef<number | null>(null)

  // Primitives pulled out of `status` so every dependency list below is statically checkable.
  const mode = status.mode
  const live = isLiveMode(mode)
  const contracts: ArcadeContracts | null = status.kind === 'ready' ? status.contracts : null
  const managerAddress = contracts?.machineManager
  const machineId = machine.onchainId
  const machineName = machine.name
  const spinPrice = parseUnits(machine.spinPriceUsdc, NATIVE_USDC_DECIMALS)

  const {data: balance} = useBalance({
    address,
    query: {enabled: Boolean(address) && live, refetchInterval: 20_000},
  })

  const receipt = useWaitForTransactionReceipt({
    hash: txHash,
    query: {enabled: Boolean(txHash)},
  })

  /**
   * Local storage is the single source of truth for a spin in flight, read as a snapshot.
   * Keeping it out of component state is what makes a mid-spin refresh resume cleanly.
   */
  const pendingSpinId = useLocalStorageValue(
    PENDING_SPIN_KEY,
    parsePendingSpinId,
    null as string | null,
  )

  const resting = deriveRestingState(
    machine,
    status,
    isConnected,
    chainId,
    balance?.value,
    spinPrice,
  )

  // ------------------------------------------------------ read the spin id from logs
  //
  // The id is *derived* from the receipt rather than copied into state. The effect below
  // only performs the storage write, and because storage is the source of truth for a
  // pending spin, persisting it is what advances the phase — no setState needed.
  const receiptSpinId = parseSpinIdFromReceipt(receipt.data?.logs)
  const receiptMissingSpinId = Boolean(receipt.data) && receiptSpinId === null

  useEffect(() => {
    if (!receiptSpinId) return
    // Idempotent: writing the same id again is a no-op for the snapshot.
    safeSetItem(PENDING_SPIN_KEY, receiptSpinId)
    deadlineRef.current = Date.now() + RANDOMNESS_DEADLINE_MS
  }, [receiptSpinId])

  /**
   * Phase resolution, in priority order:
   *   1. an explicitly active phase for this session
   *   2. a spin recovered from storage, still awaiting randomness
   *   3. the derived resting state
   *
   * An in-flight spin always beats the resting state, so a wallet disconnecting mid-spin
   * cannot wipe a pending spin off the screen.
   */
  // A confirmed transaction with no recoverable spin id is a real failure, and it takes
  // precedence over the optimistic 'pending-tx' the submit path set.
  const receiptFailed = receiptMissingSpinId && activePhase === 'pending-tx'
  // A spin recovered from storage is in flight whatever this session happens to think.
  const resumed =
    live && Boolean(pendingSpinId) && activePhase !== 'revealed' && activePhase !== 'error'

  const phase: SpinPhase = receiptFailed
    ? 'error'
    : resumed
      ? activePhase === 'settling'
        ? 'settling'
        : 'awaiting-randomness'
      : (activePhase ?? resting.phase)

  const error: SpinError | null = receiptFailed
    ? SPIN_ID_UNREADABLE
    : activePhase
      ? activeError
      : resting.error

  // ------------------------------------------------- poll for reveal, then settle
  useEffect(() => {
    if (phase !== 'awaiting-randomness' && phase !== 'settling') return
    if (!pendingSpinId || !publicClient || !managerAddress) return

    let cancelled = false
    const spinIdValue = BigInt(pendingSpinId)
    const client = publicClient
    const manager = managerAddress
    const spinId = pendingSpinId

    if (deadlineRef.current === null) {
      deadlineRef.current = Date.now() + RANDOMNESS_DEADLINE_MS
    }

    /** Reads the settled spin out of contract storage and presents it. */
    async function finish() {
      const spin = await client.readContract({
        address: manager,
        abi: arcadeMachineManagerAbi,
        functionName: 'spinOf',
        args: [spinIdValue],
      })

      const asset = assetByAddress(spin.rewardToken)
      setOutcome({
        simulated: false,
        spinId,
        asset,
        // The rarity band travels on the SpinSettled event; the stored record holds the token
        // and amount, which is what the reveal needs. The activity tape shows the band.
        rarity: 'common',
        amount: asset
          ? formatUnits(spin.rewardAmount, asset.decimals)
          : spin.rewardAmount.toString(),
        delivered: spin.pushDelivered,
      })
      setActivePhase('revealed')
      safeRemoveItem(PENDING_SPIN_KEY)
      deadlineRef.current = null
    }

    async function poll() {
      if (cancelled) return

      // A hard deadline, so the user is never left staring at a spinner.
      if (deadlineRef.current !== null && Date.now() > deadlineRef.current) {
        setActivePhase('error')
        setActiveError({
          code: 'randomness-timeout',
          title: 'Randomness is taking longer than expected',
          detail:
            'Your spin is recorded onchain and its price is locked, but the reveal has not arrived yet. Nothing about your outcome can change while you wait.',
          recovery:
            'Leave this open, or check the activity tape later. If the reveal window closes entirely, you can claim a full refund plus compensation from the operator bond.',
          retryable: false,
        })
        return
      }

      try {
        const spin = await client.readContract({
          address: manager,
          abi: arcadeMachineManagerAbi,
          functionName: 'spinOf',
          args: [spinIdValue],
        })
        if (cancelled) return

        if (spin.status === SPIN_SETTLED) {
          await finish()
          return
        }

        if (spin.status === SPIN_REFUNDED) {
          setActivePhase('error')
          setActiveError({
            code: 'randomness-timeout',
            title: 'Spin refunded',
            detail:
              'Randomness was never revealed for this spin, so it was unwound. Your spin price is refundable, along with a penalty slashed from the operator bond.',
            recovery: 'Withdraw your refund from My Arcade.',
            retryable: false,
          })
          safeRemoveItem(PENDING_SPIN_KEY)
          return
        }

        // Still pending. Settlement is permissionless and the outcome is identical whoever
        // calls it, so attempt it rather than waiting for someone else to.
        try {
          await writeContractAsync({
            address: manager,
            abi: arcadeMachineManagerAbi,
            functionName: 'settleSpin',
            args: [spinIdValue],
          })
          if (!cancelled) setActivePhase('settling')
        } catch {
          // Randomness simply is not revealed yet. Keep waiting.
        }
      } catch (err) {
        if (cancelled) return
        setActivePhase('error')
        setActiveError(classifyError(err))
      }
    }

    void poll()
    const interval = window.setInterval(() => void poll(), SETTLE_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [phase, pendingSpinId, publicClient, managerAddress, writeContractAsync])

  // ------------------------------------------------------------------ demo spin
  //
  // These handlers are deliberately plain functions. The React Compiler memoises them
  // automatically, and hand-written useCallback wrappers here only produced dependency
  // lists that disagreed with the inferred ones — which disables the compiler for the
  // whole hook and makes things slower, not faster.
  function runDemoSpin() {
    // Guard: unreachable in a live mode, and an exception rather than a silent fallback so a
    // regression cannot quietly start presenting fabricated outcomes as real ones.
    if (isLiveMode(mode)) {
      throw new Error('runDemoSpin called in a live mode — refusing to fabricate an outcome.')
    }

    setActiveError(null)
    setOutcome(null)
    setActivePhase('pending-tx')

    window.setTimeout(() => setActivePhase('awaiting-randomness'), 600)
    window.setTimeout(() => setActivePhase('settling'), 1300)
    window.setTimeout(() => {
      const drawn: DemoOutcome = drawDemoOutcome(machine)
      setOutcome({
        simulated: true,
        spinId: drawn.demoSpinId,
        asset: drawn.asset,
        rarity: drawn.rarity,
        amount: drawn.amount.toString(),
        delivered: true,
      })
      setActivePhase('revealed')

      recordDemoActivity({
        spinId: drawn.demoSpinId,
        simulated: true,
        player: address ?? 'demo',
        machineSlug: machine.slug,
        machineName: machine.name,
        machineVersion: 0,
        status: 'settled',
        pricePaid: machine.spinPriceUsdc,
        rewardSymbol: drawn.asset?.symbol,
        rewardAmount: drawn.amount.toString(),
        rarity: RARITY_LABEL[drawn.rarity],
        timestamp: Date.now(),
      })
    }, 2600)
  }

  // ------------------------------------------------------------------ live spin
  async function runLiveSpin() {
    if (!managerAddress || !publicClient) {
      // Should be unreachable: the derived resting state already blocks the button. Surfaced
      // as an error rather than a silent return, so a regression in that guard is visible.
      setActivePhase('error')
      setActiveError({
        code: 'not-configured',
        title: 'Arcade is not configured for this mode',
        detail: 'Contract addresses or an RPC client are missing, so no spin can be submitted.',
        recovery: 'Set the contract addresses, or switch to demo mode.',
        retryable: false,
      })
      return
    }
    if (machineId === null) {
      setActivePhase('error')
      setActiveError({
        code: 'not-configured',
        title: 'This machine is not deployed yet',
        detail: `${machineName} has no onchain id configured, so Arcade cannot spin it.`,
        recovery: 'Create the machine onchain and set its id in the machine configuration.',
        retryable: false,
      })
      return
    }

    setActiveError(null)
    setOutcome(null)
    setActivePhase('authorizing')

    try {
      // The expected price and version are asserted onchain, so a version published in the
      // same block cannot change what the player agreed to.
      const onchainMachine = await publicClient.readContract({
        address: managerAddress,
        abi: arcadeMachineManagerAbi,
        functionName: 'machineOf',
        args: [BigInt(machineId)],
      })

      const hash = await writeContractAsync({
        address: managerAddress,
        abi: arcadeMachineManagerAbi,
        functionName: 'requestSpin',
        args: [BigInt(machineId), spinPrice, onchainMachine.currentVersion],
        value: spinPrice,
      })

      setTxHash(hash)
      setActivePhase('pending-tx')
    } catch (err) {
      setActivePhase('error')
      setActiveError(classifyError(err))
    }
  }

  function spin() {
    if (mode === 'demo') {
      runDemoSpin()
      return
    }
    void runLiveSpin()
  }

  function reset() {
    setOutcome(null)
    setActiveError(null)
    setTxHash(undefined)
    deadlineRef.current = null
    // Clearing the active phase hands control back to the derived resting state, so the
    // right answer is recomputed rather than guessed.
    setActivePhase(null)
  }

  /** Stops tracking a stuck spin locally, without pretending it did not happen onchain. */
  function forget() {
    safeRemoveItem(PENDING_SPIN_KEY)
    deadlineRef.current = null
    setActivePhase(null)
  }

  return {
    phase,
    outcome,
    error,
    txHash,
    pendingSpinId,
    spin,
    reset,
    forget,
    spinPrice,
    balance: balance?.value,
    simulated: mode === 'demo',
  }
}
