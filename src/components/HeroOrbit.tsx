'use client'

import {useState} from 'react'
import {OrbitMachine, type OrbitPhase} from './OrbitMachine'
import type {RewardAsset} from '@/config/rewards'
import {drawDemoIndex} from '@/lib/demoOutcome'
import {Label} from './ui/Primitives'

/**
 * The hero's interactive Orbit Machine.
 *
 * Clicking it runs a clearly-labelled **demonstration** of the spin choreography. The index
 * comes from `crypto.getRandomValues`, and the surrounding copy says DEMONSTRATION in plain
 * text — because a preview that looks like a real spin is exactly the kind of thing that
 * misleads someone into thinking they played.
 *
 * Nothing here touches a wallet, a contract, or any funds.
 */
export function HeroOrbit({assets}: {assets: RewardAsset[]}) {
  const [phase, setPhase] = useState<OrbitPhase>('ready')
  const [settledIndex, setSettledIndex] = useState<number | null>(null)

  function runDemo() {
    if (phase === 'pending' || phase === 'settling') return

    setSettledIndex(null)
    setPhase('pending')

    window.setTimeout(() => setPhase('settling'), 700)
    window.setTimeout(() => {
      setSettledIndex(drawDemoIndex(assets.length))
      setPhase('revealed')
    }, 2100)
  }

  function reset() {
    setSettledIndex(null)
    setPhase('ready')
  }

  const revealed = phase === 'revealed' && settledIndex !== null ? assets[settledIndex] : undefined

  return (
    <div className="relative">
      <OrbitMachine
        assets={assets}
        phase={phase}
        settledIndex={settledIndex}
        priceLabel="2 USDC"
        onActivate={phase === 'revealed' ? reset : runDemo}
        actionLabel={phase === 'revealed' ? 'Again' : phase === 'ready' ? 'Try it' : undefined}
        size="hero"
      />

      <div className="mt-2 flex items-center justify-center gap-3 text-center">
        <span aria-hidden="true" className="h-px w-6 bg-hairline-strong" />
        <Label>
          {revealed ? `Demonstration — ${revealed.symbol}` : 'Demonstration — no funds move'}
        </Label>
        <span aria-hidden="true" className="h-px w-6 bg-hairline-strong" />
      </div>

      {/* A live region so the demo outcome is announced rather than only drawn. */}
      <p aria-live="polite" className="sr-only">
        {revealed
          ? `Demonstration outcome: ${revealed.symbol}. This was a simulation and no funds moved.`
          : ''}
      </p>
    </div>
  )
}
