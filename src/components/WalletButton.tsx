'use client'

import {useState} from 'react'
import {useAccount, useDisconnect, useBalance, useSwitchChain} from 'wagmi'
import {useAppKit} from '@reown/appkit/react'
import {Button, Modal, DataRow, Dot} from './ui/Primitives'
import {expectedChain} from '@/config/wagmi'
import {formatUsdc, shortAddress} from '@/lib/format'
import {useIsMounted} from '@/hooks/useClientState'

/**
 * Wallet connect / account control.
 *
 * ## Connecting is Reown AppKit's dialog
 *
 * `open()` raises AppKit's modal, which lists installed browser extensions, the WalletConnect
 * QR for phones, and Reown's wallet catalogue. Arcade used to connect straight to the
 * WalletConnect connector, which on desktop could only ever draw a QR code — an extension in
 * the same browser has no way to answer a relay meant for a second device.
 *
 * The account view below stays ours. It is product surface — balance in native USDC, the
 * network Arcade expects — not wallet plumbing, and AppKit's account screen says none of it.
 */
export function WalletButton() {
  const {address, isConnected, chainId, connector} = useAccount()
  const {disconnect} = useDisconnect()
  // Named to keep it distinct from the account dialog's own `open` state below.
  const {open: openAppKit} = useAppKit()
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
    return (
      <Button size="sm" onClick={() => void openAppKit()}>
        Connect Wallet
      </Button>
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

