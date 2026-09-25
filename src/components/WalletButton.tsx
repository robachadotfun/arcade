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
 * ## Why this picks a connector instead of connecting straight away
 *
 * This used to connect to `connectors[0]`, which is always WalletConnect. On a desktop with
 * MetaMask installed that is the wrong answer: the relay can only offer a QR code, so the
 * extension sitting in the toolbar was unreachable and the only way through was to scan with
 * a phone. wagmi already discovers extensions over EIP-6963, so they were present as
 * connectors the whole time — nothing ever offered them.
 *
 * So: extensions are listed when any are installed, with WalletConnect kept as the option for
 * phones and for wallets that have no extension. With none installed there is nothing to
 * choose between and it connects straight to WalletConnect, as before.
 *
 * The earlier reason for removing the picker was that several installed extensions overflowed
 * the viewport and the dialog could not scroll. `Modal` caps its height and scrolls internally
 * now, so a long list is no longer a trap.
 *
 * The account view below is still ours — it is product surface, not wallet plumbing.
 */
export function WalletButton() {
  const {address, isConnected, chainId, connector} = useConnection()
  const {connect, connectors, isPending, error} = useConnect()
  const {disconnect} = useDisconnect()
  const {switchChain, isPending: isSwitching} = useSwitchChain()
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
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
    /*
     * Extensions are discovered over EIP-6963, so each announces itself as its own connector
     * with its real name and icon. Anything that is not an extension is the relay.
     */
    const extensions = connectors.filter((c) => c.type === 'injected')
    const relay = connectors.find((c) => c.type !== 'injected')
    const onlyRelay = extensions.length === 0

    return (
      <>
        <Button
          size="sm"
          disabled={isPending || connectors.length === 0}
          onClick={() => {
            // Nothing to choose between with no extension installed, so skip the dialog.
            if (onlyRelay) {
              if (relay) connect({connector: relay})
            } else {
              setPicking(true)
            }
          }}
        >
          {isPending ? 'Connecting…' : 'Connect Wallet'}
        </Button>

        <Modal
          open={picking}
          onClose={() => setPicking(false)}
          title="Connect a wallet"
          description="Arcade never sees your keys. It only asks your wallet to sign."
        >
          <ul className="divide-y divide-hairline-faint border-y border-hairline-faint">
            {extensions.map((c) => (
              <li key={c.uid}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-1 py-3 text-left transition-colors hover:bg-paper-deep disabled:opacity-50"
                  disabled={isPending}
                  onClick={() => {
                    connect({connector: c})
                    setPicking(false)
                  }}
                >
                  {c.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.icon} alt="" aria-hidden="true" className="h-6 w-6 shrink-0" />
                  ) : (
                    <span aria-hidden="true" className="h-6 w-6 shrink-0 border border-hairline" />
                  )}
                  <span className="text-[0.9375rem] text-ink">{c.name}</span>
                  <span className="ml-auto font-mono text-[0.6875rem] uppercase tracking-wide text-ink-faint">
                    Extension
                  </span>
                </button>
              </li>
            ))}

            {relay ? (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-1 py-3 text-left transition-colors hover:bg-paper-deep disabled:opacity-50"
                  disabled={isPending}
                  onClick={() => {
                    connect({connector: relay})
                    setPicking(false)
                  }}
                >
                  <span aria-hidden="true" className="h-6 w-6 shrink-0 border border-hairline" />
                  <span className="text-[0.9375rem] text-ink">{relay.name}</span>
                  <span className="ml-auto font-mono text-[0.6875rem] uppercase tracking-wide text-ink-faint">
                    QR code
                  </span>
                </button>
              </li>
            ) : null}
          </ul>

          <p className="mt-4 text-[0.8125rem] leading-relaxed text-ink-muted">
            Scanning the QR code connects a wallet on your phone. Use it only if the wallet you
            want has no browser extension.
          </p>
        </Modal>

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

