'use client'

import {useState} from 'react'
import {useConnection, useConnect, useDisconnect, useBalance, useSwitchChain} from 'wagmi'
import {Button, Modal, DataRow, Dot} from './ui/Primitives'
import {expectedChain} from '@/config/wagmi'
import {formatUsdc, shortAddress} from '@/lib/format'
import {useIsMounted} from '@/hooks/useClientState'

/**
 * Wallet connect / account control.
 *
 * Wallet selection is Reown's modal, not ours. Arcade used to open its own dialog listing
 * every connector, which broke down on a machine with several wallet extensions installed:
 * each one is discovered as a separate connector, the list outgrew the viewport, and the
 * dialog had no way to scroll. With a single WalletConnect connector there is nothing to
 * choose between, so this connects directly and lets Reown handle the rest.
 *
 * The account view below is still ours — it is product surface, not wallet plumbing.
 */
export function WalletButton() {
  const {address, isConnected, chainId, connector} = useConnection()
  const {connect, connectors, isPending, error} = useConnect()
  const {disconnect} = useDisconnect()
  const {switchChain, isPending: isSwitching} = useSwitchChain()
  const [open, setOpen] = useState(false)
  // Wallet state only exists on the client; render a stable shell until hydration so the
  // server and client markup agree.
  const mounted = useIsMounted()

  const {data: balance} = useBalance({
    address,
    query: {enabled: Boolean(address), refetchInterval: 20_000},
  })

  const wrongNetwork = isConnected && chainId !== undefined && chainId !== expectedChain.id

  if (!mounted) {
    return (
      <Button variant="secondary" size="sm" disabled>
        Connect Wallet
      </Button>
    )
  }

  if (!isConnected) {
    const connector = connectors[0]
    return (
      <>
        <Button
          size="sm"
          disabled={isPending || !connector}
          onClick={() => {
            if (connector) connect({connector})
          }}
        >
          {isPending ? 'Connecting…' : 'Connect Wallet'}
        </Button>
        {error ? (
          <p role="alert" className="sr-only">
            {error.message}
          </p>
        ) : null}
      </>
    )
  }

  if (wrongNetwork) {
    return (
      <Button
        size="sm"
        variant="danger"
        onClick={() => switchChain({chainId: expectedChain.id})}
        disabled={isSwitching}
      >
        {isSwitching ? 'Switching…' : `Switch to ${expectedChain.name}`}
      </Button>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-2 border border-hairline-strong px-2.5 transition-colors hover:bg-paper-deep"
      >
        <Dot tone="live" />
        <span className="font-mono text-[0.75rem] text-ink">{shortAddress(address)}</span>
        {balance ? (
          <span className="hidden font-mono text-[0.75rem] text-ink-muted sm:inline" data-numeric="">
            {formatUsdc(balance.value)}
          </span>
        ) : null}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Wallet"
        description="Your account, as Arcade sees it."
      >
        <dl className="divide-y divide-hairline-faint border-y border-hairline-faint">
          <DataRow label="Address" value={address ?? '—'} mono />
          <DataRow label="Network" value={expectedChain.name} />
          <DataRow
            label="USDC balance"
            value={balance ? `${formatUsdc(balance.value)} USDC` : '—'}
            mono
          />
          <DataRow label="Connector" value={connector?.name ?? '—'} />
        </dl>
        <p className="mt-4 text-[0.8125rem] leading-relaxed text-ink-muted">
          Balance is native USDC, the gas asset on Arc. It uses 18 decimals, unlike the USDC
          ERC-20 interface, which uses 6.
        </p>
        <div className="mt-6 flex gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => {
              disconnect()
              setOpen(false)
            }}
          >
            Disconnect
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </Modal>
    </>
  )
}

