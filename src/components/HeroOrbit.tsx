'use client'

import {useRouter} from 'next/navigation'
import {OrbitMachine} from './OrbitMachine'
import type {RewardAsset} from '@/config/rewards'
import {Label} from './ui/Primitives'

/**
 * The hero's Orbit Machine.
 *
 * ## Why this does not spin
 *
 * It used to. Clicking it ran the full choreography and revealed a random asset, labelled a
 * demonstration. That label was honest, but the thing underneath it was still a spin outcome
 * decided in the browser — and this product's whole claim is that no outcome is ever decided
 * anywhere but onchain. A landing page that fakes the one thing the product promises not to
 * fake is a bad trade, however carefully it is captioned.
 *
 * So the hero is now an ambient showcase: the orbit turns continuously through the reward
 * assets that are actually registered, never settles, and never claims a result. The centre
 * control goes to the real machine, where a spin costs real USDC and resolves onchain.
 *
 * Everything shown here is true — these are the live reward assets, in their real order.
 */
export function HeroOrbit({assets}: {assets: RewardAsset[]}) {
  const router = useRouter()

  return (
    <div className="relative">
      <OrbitMachine
        assets={assets}
        // Permanently at rest and turning: there is no settled index because nothing has
        // settled. The component cannot render a winner without one.
        phase="ready"
        settledIndex={null}
        priceLabel="From 2 USDC"
        onActivate={() => router.push('/play')}
        actionLabel="Open it"
        size="hero"
      />

      <div className="mt-2 flex items-center justify-center gap-3 text-center">
        <span aria-hidden="true" className="h-px w-6 bg-hairline-strong" />
        <Label>{assets.length} reward assets in orbit</Label>
        <span aria-hidden="true" className="h-px w-6 bg-hairline-strong" />
      </div>
    </div>
  )
}
