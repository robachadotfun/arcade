'use client'

import {useState} from 'react'
import {useConnection, useConnect, useDisconnect, useBalance, useSwitchChain, type Connector} from 'wagmi'
import {Button, Modal, Label, DataRow, Dot} from './ui/Primitives'
import {expectedChain} from '@/config/wagmi'
import {resolveMode, isLiveMode} from '@/config/mode'
import {formatUsdc, shortAddress} from '@/lib/format'
import {useIsMounted} from '@/hooks/useClientState'

/**
 * Wallet connect / account control.
 *
 * Bespoke rather than RainbowKit: see `config/wagmi.ts` for why. Everything here is real
 * button and dialog semantics, so it is keyboard and screen-reader navigable without a
 * component library.
 */
export function WalletButton() {
  const status = resolveMode()
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

  // Demo mode: a wallet is optional, so this is an invitation rather than a gate.
  if (status.mode === 'demo' && !isConnected) {
    return (
      <>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Connect Wallet
        </Button>
        <ConnectDialog
          open={open}
          onClose={() => setOpen(false)}
          connectors={connectors}
          onConnect={(c) => connect({connector: c})}
          isPending={isPending}
          error={error?.message}
          note="Demo mode does not require a wallet. Connecting only personalises the interface — no transaction is ever requested."
        />
      </>
    )
  }

  if (!isConnected) {
    return (
      <>
        <Button size="sm" onClick={() => setOpen(true)}>
          Connect Wallet
        </Button>
        <ConnectDialog
          open={open}
          onClose={() => setOpen(false)}
          connectors={connectors}
          onConnect={(c) => connect({connector: c})}
          isPending={isPending}
          error={error?.message}
        />
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
        {balance && isLiveMode(status.mode) ? (
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

function ConnectDialog({
  open,
  onClose,
  connectors,
  onConnect,
  isPending,
  error,
  note,
}: {
  open: boolean
  onClose: () => void
  connectors: readonly Connector[]
  onConnect: (connector: Connector) => void
  isPending: boolean
  error?: string
  note?: string
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect a wallet"
      description={note ?? `Arcade uses ${expectedChain.name}. Spins are paid in native USDC.`}
    >
      {connectors.length === 0 ? (
        <div className="border border-hairline p-4">
          <Label>No wallet detected</Label>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-muted">
            No EVM browser wallet was found. Install one, then reload this page.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {connectors.map((connector) => (
            <li key={connector.uid}>
              <button
                type="button"
                onClick={() => {
                  onConnect(connector)
                  onClose()
                }}
                disabled={isPending}
                className="flex w-full items-center justify-between border border-hairline px-4 py-3.5 text-left transition-colors hover:bg-paper-deep disabled:opacity-50"
              >
                <span className="text-[0.9375rem] text-ink">{connector.name}</span>
                <svg viewBox="0 0 12 12" className="size-3 text-ink-faint" fill="none" aria-hidden="true">
                  <path d="M4 2.5L7.5 6L4 9.5" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="mt-4 border border-signal-stop/30 bg-signal-stop/5 p-3 text-[0.8125rem] text-signal-stop">
          {error}
        </p>
      ) : null}

      <p className="mt-5 text-[0.75rem] leading-relaxed text-ink-faint">
        Arcade never asks for a seed phrase or private key. You approve every transaction in
        your own wallet.
      </p>
    </Modal>
  )
}
