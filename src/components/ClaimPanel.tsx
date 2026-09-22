'use client'

import {useState} from 'react'
import {useWriteContract, useWaitForTransactionReceipt} from 'wagmi'
import {formatUnits} from 'viem'
import {prizeVaultAbi, arcadeMachineManagerAbi} from '@/abi'
import {TokenGlyph} from './OrbitMachine'
import {Button, Label, Pill, ExternalLink} from './ui/Primitives'
import {resolveMode} from '@/config/mode'
import {explorerUrl, ARC_MAINNET_ID} from '@/config/network'
import type {RewardAsset} from '@/config/rewards'
import {formatDecimalAmount, formatUsdc} from '@/lib/format'
import {labelFor} from '@/config/rewards'

/**
 * Claims rewards that could not be pushed, and native-USDC refunds from abandoned spins.
 *
 * `claimMany` batches token claims into one transaction. Failures are surfaced with a real
 * message and the panel stays usable — a failed claim never consumes the entitlement,
 * because the vault only zeroes a balance inside the same transaction that transfers it.
 */
export function ClaimPanel({
  claimable,
  refundable,
  onClaimed,
}: {
  claimable: Array<{asset: RewardAsset; amount: bigint}>
  refundable: bigint
  onClaimed: () => void
}) {
  const status = resolveMode()
  const contracts = status.kind === 'ready' ? status.contracts : null
  const chainId = status.kind === 'ready' && status.chainId ? status.chainId : ARC_MAINNET_ID
  const {writeContractAsync, isPending} = useWriteContract()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [error, setError] = useState<string | null>(null)

  const receipt = useWaitForTransactionReceipt({hash: txHash, query: {enabled: Boolean(txHash)}})

  const nothingToClaim = claimable.length === 0 && refundable === 0n

  async function claimAll() {
    if (!contracts) return
    setError(null)
    try {
      const hash = await writeContractAsync({
        address: contracts.prizeVault,
        abi: prizeVaultAbi,
        functionName: 'claimMany',
        args: [claimable.map((entry) => entry.asset.address)],
      })
      setTxHash(hash)
      onClaimed()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The claim could not be submitted.')
    }
  }

  async function withdrawRefund() {
    if (!contracts) return
    setError(null)
    try {
      const hash = await writeContractAsync({
        address: contracts.machineManager,
        abi: arcadeMachineManagerAbi,
        functionName: 'withdrawRefund',
        args: [],
      })
      setTxHash(hash)
      onClaimed()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The refund could not be withdrawn.')
    }
  }

  if (nothingToClaim) {
    return (
      <div className="border border-hairline bg-paper-raised p-6">
        <Label>Nothing waiting</Label>
        <p className="mt-3 max-w-[54ch] text-[0.9375rem] leading-relaxed text-ink-muted">
          Every reward you have won was delivered straight to your wallet. Rewards only appear
          here when a direct transfer fails — if a token pauses, or blacklists an address — in
          which case they stay reserved for you and become claimable.
        </p>
      </div>
    )
  }

  return (
    <div className="border border-arc/25 bg-arc-wash p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Label className="text-arc">Claimable</Label>
        {receipt.isSuccess ? <Pill tone="live">Claim confirmed</Pill> : null}
      </div>

      {claimable.length > 0 ? (
        <ul className="mt-5 divide-y divide-hairline-faint border-y border-hairline-faint">
          {claimable.map(({asset, amount}) => (
            <li key={asset.address} className="flex items-center gap-3 py-3">
              <TokenGlyph asset={asset} size={26} />
              <span className="flex-1 text-[0.9375rem] text-ink">{labelFor(asset)}</span>
              <span className="font-mono text-[0.9375rem] text-ink" data-numeric="">
                {formatDecimalAmount(Number.parseFloat(formatUnits(amount, asset.decimals)))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {refundable > 0n ? (
        <div className="mt-5 border border-hairline bg-paper-raised p-4">
          <Label>Refund owed</Label>
          <p className="mt-2 font-mono text-[1.125rem] text-ink" data-numeric="">
            {formatUsdc(refundable)} USDC
          </p>
          <p className="mt-2 max-w-[52ch] text-[0.8125rem] leading-relaxed text-ink-muted">
            A spin whose randomness was never revealed. This is your spin price back in full, plus
            any penalty slashed from the operator&apos;s bond.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-5 border border-signal-stop/30 bg-signal-stop/5 p-3 text-[0.8125rem] leading-relaxed text-signal-stop">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {claimable.length > 0 ? (
          <Button onClick={() => void claimAll()} disabled={isPending || receipt.isLoading}>
            {isPending || receipt.isLoading ? 'Claiming…' : `Claim all (${claimable.length})`}
          </Button>
        ) : null}
        {refundable > 0n ? (
          <Button
            variant="secondary"
            onClick={() => void withdrawRefund()}
            disabled={isPending || receipt.isLoading}
          >
            Withdraw refund
          </Button>
        ) : null}
        {txHash ? (
          <ExternalLink href={explorerUrl(chainId, 'tx', txHash)}>
            <span className="font-mono text-[0.75rem]">View transaction</span>
          </ExternalLink>
        ) : null}
      </div>

      <p className="mt-5 text-[0.75rem] leading-relaxed text-ink-faint">
        Claiming is a pull: the vault only zeroes your balance inside the same transaction that
        transfers it, so a failed claim never costs you the entitlement.
      </p>
    </div>
  )
}
