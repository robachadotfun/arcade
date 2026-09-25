'use client'

import {useState} from 'react'
import {
  useBalance,
  useAccount,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import {formatUnits, type Address} from 'viem'
import {feeRouterAbi} from '@/abi'
import {resolveMode} from '@/config/mode'
import {NATIVE_USDC_DECIMALS, explorerUrl} from '@/config/network'
import {expectedChain} from '@/config/wagmi'
import {Label, SectionHead, DataRow, Button, Pill, ExternalLink} from '../ui/Primitives'
import {WalletButton} from '../WalletButton'

/**
 * Treasury: where spin revenue sits, and the control to sweep it out.
 *
 * ## How revenue actually reaches here
 *
 * A spin's payment stays in the machine manager until the spin settles — so a refundable spin
 * still has its money where the refund can be paid from. On settlement the manager forwards
 * the payment to the fee router, which holds it until someone calls `distribute()`.
 *
 * Nothing sweeps automatically, and that is deliberate: an unattended transfer of every
 * spin's takings is a worse default than a balance an operator moves on purpose.
 *
 * ## Why this panel cannot grant itself anything
 *
 * `distribute()` is `onlyRole(TREASURER)` and the destinations are `DEFAULT_ADMIN_ROLE`. The
 * contracts enforce both. This panel only builds the transaction; a wallet without the role
 * gets a revert, not a silent failure, and the button says so before it is pressed rather
 * than after.
 */
export function TreasuryPanel() {
  const status = resolveMode()
  const {address, isConnected, chainId} = useAccount()
  const router = status.kind === 'ready' ? status.contracts.feeRouter : undefined
  const explorerChain = status.kind === 'ready' ? status.chainId : expectedChain.id

  const {data, refetch, isLoading} = useReadContracts({
    contracts: router
      ? [
          {address: router, abi: feeRouterAbi, functionName: 'rewardFundingBps'},
          {address: router, abi: feeRouterAbi, functionName: 'rewardFundingWallet'},
          {address: router, abi: feeRouterAbi, functionName: 'treasuryWallet'},
        ]
      : [],
    query: {enabled: Boolean(router), refetchInterval: 30_000},
  })

  // The router holds native USDC, so its balance is a chain balance, not a contract call.
  const {data: balance, refetch: refetchBalance} = useBalance({
    address: router,
    query: {enabled: Boolean(router), refetchInterval: 30_000},
  })

  const {writeContractAsync, isPending} = useWriteContract()
  const [hash, setHash] = useState<`0x${string}` | undefined>(undefined)
  const receipt = useWaitForTransactionReceipt({hash, query: {enabled: Boolean(hash)}})

  const bps = data?.[0]?.status === 'success' ? Number(data[0].result) : null
  const rewardWallet = data?.[1]?.status === 'success' ? (data[1].result as Address) : null
  const treasuryWallet = data?.[2]?.status === 'success' ? (data[2].result as Address) : null

  const sameDestination =
    rewardWallet && treasuryWallet && rewardWallet.toLowerCase() === treasuryWallet.toLowerCase()

  const isTreasuryWallet =
    address && treasuryWallet && address.toLowerCase() === treasuryWallet.toLowerCase()

  const wrongNetwork = isConnected && chainId !== expectedChain.id

  async function distribute() {
    if (!router) return
    const tx = await writeContractAsync({
      address: router,
      abi: feeRouterAbi,
      functionName: 'distribute',
    })
    setHash(tx)
    void refetch()
    void refetchBalance()
  }

  if (status.kind !== 'ready') {
    return (
      <section>
        <SectionHead eyebrow="Treasury" title="No deployment configured." />
        <p className="mt-6 max-w-[60ch] text-[0.9375rem] leading-relaxed text-ink-muted">
          Revenue has nowhere to accrue until Arcade is pointed at a deployment.
        </p>
      </section>
    )
  }

  return (
    <section>
      <SectionHead eyebrow="Treasury" title="Where the revenue sits." />

      <p className="mt-6 max-w-[68ch] text-[0.9375rem] leading-relaxed text-ink-muted">
        A spin&apos;s payment stays in the machine manager until that spin settles, so a
        refundable spin still has its money where the refund comes from. On settlement it moves
        to the fee router and waits here. Nothing sweeps on its own.
      </p>

      <dl className="mt-8 max-w-[44rem] divide-y divide-hairline-faint border-y border-hairline-faint">
        <DataRow
          label="Fee router"
          value={
            <ExternalLink href={explorerUrl(explorerChain, 'address', status.contracts.feeRouter)}>
              <span className="font-mono text-[0.75rem]">{status.contracts.feeRouter}</span>
            </ExternalLink>
          }
        />
        <DataRow
          label="Awaiting distribution"
          value={
            balance
              ? `${Number(formatUnits(balance.value, NATIVE_USDC_DECIMALS)).toFixed(4)} USDC`
              : 'Reading…'
          }
        />
        <DataRow
          label="Split"
          value={
            bps === null
              ? 'Reading…'
              : `${bps / 100}% reward funding / ${(10_000 - bps) / 100}% treasury`
          }
        />
        <DataRow
          label="Reward funding wallet"
          value={<span className="font-mono text-[0.75rem] break-all">{rewardWallet ?? '—'}</span>}
        />
        <DataRow
          label="Treasury wallet"
          value={<span className="font-mono text-[0.75rem] break-all">{treasuryWallet ?? '—'}</span>}
        />
      </dl>

      {sameDestination ? (
        <p className="mt-4 max-w-[60ch] text-[0.8125rem] leading-relaxed text-ink-faint">
          Both destinations are the same wallet, so the split has no practical effect — every
          distribution lands in one place.
        </p>
      ) : null}

      <div className="mt-10 border border-hairline bg-paper-deep/40 p-6">
        <Label>Claim revenue</Label>

        {!isConnected ? (
          <>
            <p className="mt-3 max-w-[54ch] text-[0.9375rem] leading-relaxed text-ink-muted">
              Connect the treasury wallet to sweep the router. The contract checks the role, so
              connecting a wallet without it will revert rather than do anything unexpected.
            </p>
            <div className="mt-4">
              <WalletButton />
            </div>
          </>
        ) : wrongNetwork ? (
          <p className="mt-3 text-[0.9375rem] text-signal-warn">
            Wrong network. Switch to {expectedChain.name} to continue.
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Pill tone={isTreasuryWallet ? 'live' : 'warn'}>
                {isTreasuryWallet ? 'Treasury wallet connected' : 'Not the treasury wallet'}
              </Pill>
              {isLoading ? <Label>Reading…</Label> : null}
            </div>

            {!isTreasuryWallet ? (
              <p className="mt-3 max-w-[56ch] text-[0.8125rem] leading-relaxed text-ink-muted">
                The connected wallet is not the configured treasury destination. It may still
                hold the TREASURER role — the contract decides, not this page — but the funds
                will go to the destination above regardless of who sends the transaction.
              </p>
            ) : null}

            <Button
              className="mt-5"
              onClick={() => void distribute()}
              disabled={isPending || receipt.isLoading || balance?.value === 0n}
            >
              {isPending
                ? 'Confirm in your wallet…'
                : receipt.isLoading
                  ? 'Distributing…'
                  : balance?.value === 0n
                    ? 'Nothing to distribute'
                    : `Distribute ${balance ? Number(formatUnits(balance.value, NATIVE_USDC_DECIMALS)).toFixed(2) : ''} USDC`}
            </Button>

            {hash ? (
              <p className="mt-4 text-[0.8125rem] text-ink-muted">
                {receipt.isSuccess ? 'Distributed. ' : 'Submitted. '}
                <ExternalLink href={explorerUrl(explorerChain, 'tx', hash)}>
                  <span className="font-mono text-[0.75rem]">View transaction</span>
                </ExternalLink>
              </p>
            ) : null}
          </>
        )}
      </div>

      <p className="mt-6 max-w-[68ch] text-[0.8125rem] leading-relaxed text-ink-faint">
        Sweeping moves what has settled. It says nothing about whether the machine is
        profitable — payouts leave the vault in tokens, not USDC, so the result only exists
        once those tokens are priced. <code className="font-mono">pnpm operator pnl</code>{' '}
        measures it from chain state.
      </p>
    </section>
  )
}
