'use client'

import {useEffect, useState} from 'react'
import {AdminLogin} from './AdminLogin'
import {MachineRiskPanel} from './MachineRiskPanel'
import {AdminOverview} from './AdminOverview'
import {TreasuryPanel} from './TreasuryPanel'
import {Label, SectionHead, Button, Pill} from '../ui/Primitives'

type Tab = 'overview' | 'treasury' | 'machines' | 'registry' | 'risk' | 'controls'

const TABS: Array<{key: Tab; label: string}> = [
  {key: 'overview', label: 'Overview'},
  {key: 'treasury', label: 'Treasury'},
  {key: 'machines', label: 'Machines'},
  {key: 'registry', label: 'Reward registry'},
  {key: 'risk', label: 'Risk'},
  {key: 'controls', label: 'Pause controls'},
]

/**
 * The admin surface.
 *
 * Read-heavy by design. Every state-changing action is a wallet transaction against the
 * contracts, which enforce their own role checks — so this dashboard is a cockpit, not an
 * authority. The most valuable thing it does is refuse to let an operator activate a machine
 * version whose economics or inventory would be unsafe.
 */
export function AdminDashboard() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const res = await fetch('/api/admin/session', {cache: 'no-store'})
        if (!res.ok) {
          if (!cancelled) setAuthenticated(false)
          return
        }
        const data = (await res.json()) as {authenticated?: boolean}
        if (!cancelled) setAuthenticated(Boolean(data.authenticated))
      } catch {
        if (!cancelled) setAuthenticated(false)
      }
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [])

  async function signOut() {
    await fetch('/api/admin/session', {method: 'DELETE'})
    setAuthenticated(false)
  }

  if (authenticated === null) {
    return (
      <div className="shell py-20">
        <Label>Checking session…</Label>
      </div>
    )
  }

  if (!authenticated) {
    return <AdminLogin onAuthenticated={() => setAuthenticated(true)} />
  }

  return (
    <div className="shell py-14 md:py-20">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <SectionHead eyebrow="Admin" title="Operator console" />
        <div className="flex items-center gap-3">
          <Pill tone="warn">Shared-secret auth</Pill>
          <Button variant="secondary" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>

      <div className="mt-6 border border-signal-warn/30 bg-signal-warn/4 p-4">
        <p className="max-w-[78ch] text-[0.875rem] leading-relaxed text-ink-soft">
          This console is gated by an environment-controlled shared secret. That is fine for a
          single operator and <strong>not</strong> fine for production: no per-user identity, no
          audit trail, no revocation, no second factor. Replace it before launch — every route
          goes through <code className="font-mono">verifyAdminToken</code> so there is one place
          to change. Note also that nothing here can alter state on its own: every action is a
          wallet transaction and the contracts enforce their own roles.
        </p>
      </div>

      <nav aria-label="Admin sections" className="mt-10 flex gap-2 overflow-x-auto border-b border-hairline pb-3">
        {TABS.map((item) => {
          const active = tab === item.key
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => setTab(item.key)}
              className={`shrink-0 border px-3.5 py-2 text-[0.875rem] transition-colors ${
                active
                  ? 'border-ink bg-ink text-paper'
                  : 'border-hairline text-ink-muted hover:border-hairline-strong hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="mt-10">
        {tab === 'overview' ? <AdminOverview /> : null}
        {tab === 'treasury' ? <TreasuryPanel /> : null}
        {tab === 'machines' || tab === 'risk' ? <MachineRiskPanel /> : null}
        {tab === 'registry' ? <RegistryPanel /> : null}
        {tab === 'controls' ? <ControlsPanel /> : null}
      </div>
    </div>
  )
}

function RegistryPanel() {
  return (
    <section>
      <SectionHead eyebrow="Reward registry" title="Token curation" />
      <p className="mt-6 max-w-[70ch] text-[0.9375rem] leading-relaxed text-ink-muted">
        Tokens are qualified off-chain first. Run{' '}
        <code className="font-mono">pnpm verify:tokens</code>, which reads every candidate&apos;s
        metadata from Arc Mainnet and probes its real transfer behaviour, then review{' '}
        <code className="font-mono">scripts/data/arc-token-verified.json</code> before proposing
        anything.
      </p>
      <p className="mt-4 max-w-[70ch] text-[0.9375rem] leading-relaxed text-ink-muted">
        Registration is a wallet transaction calling{' '}
        <code className="font-mono">registerToken</code> with the{' '}
        <code className="font-mono">REGISTRY_ADMIN</code> role. The contract re-asserts the symbol
        and decimals against the token itself and rejects a mismatch, so a mislabelled entry
        cannot be registered even by an authorised operator.
      </p>
      <div className="mt-8 border border-hairline bg-paper-deep/40 p-5">
        <Label>Never auto-list</Label>
        <p className="mt-3 max-w-[70ch] text-[0.9375rem] leading-relaxed text-ink-soft">
          There is no code path that adds a newly launched token to a machine automatically, and
          there should not be. Research on Arc found six ticker collisions among candidates —
          including two separate tokens squatting the symbol <strong>USDC</strong> — so automatic
          listing by ticker would be a direct route to awarding the wrong asset.
        </p>
      </div>
    </section>
  )
}

function ControlsPanel() {
  return (
    <section>
      <SectionHead eyebrow="Pause controls" title="Stopping things safely" />
      <div className="mt-8 flex flex-col gap-px bg-hairline">
        {[
          [
            'Pause a machine',
            'setMachinePaused(machineId, true)',
            'Stops new spins on one machine. Guardians can pause; only the machine admin can resume. Spins already in flight remain settleable or refundable — a pause never strands anyone.',
          ],
          [
            'Global pause',
            'pause()',
            'Stops new spins across every machine. Guardians can pause; only the top-level admin can unpause.',
          ],
          [
            'Pause a token',
            'setPaused(token, true)',
            'Removes a token from future reward tables. Rewards already won in that token stay reserved and claimable.',
          ],
          [
            'Top up commitments',
            'publishCommitments(bytes32[])',
            'If the commitment pool empties, no new spin can be accepted. Keep it well ahead of demand — commitments must exist before the spins that consume them.',
          ],
        ].map(([title, fn, detail]) => (
          <article key={title} className="bg-paper-raised p-5 md:grid md:grid-cols-[15rem_1fr] md:gap-8">
            <div>
              <h3 className="text-[1rem] text-ink">{title}</h3>
              <code className="mt-1.5 block font-mono text-[0.75rem] text-arc">{fn}</code>
            </div>
            <p className="mt-2.5 max-w-[64ch] text-[0.9375rem] leading-relaxed text-ink-muted md:mt-0">
              {detail}
            </p>
          </article>
        ))}
      </div>
    </section>
  )
}
