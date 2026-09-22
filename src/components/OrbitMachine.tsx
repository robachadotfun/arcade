'use client'

import Image from 'next/image'
import {useEffect, useMemo, useRef, useState} from 'react'
import {useReducedMotion} from 'motion/react'
import {labelFor, type RewardAsset} from '@/config/rewards'

/**
 * The Orbit Machine — Arcade's signature interaction.
 *
 * A physical arcade machine reduced to a financial instrument: instead of a slot reel,
 * reward assets travel an orbital track and the selected one settles into the centre.
 *
 * ## The rule that matters
 *
 * **This component never decides anything.** It takes a `settledIndex` prop and animates
 * toward it. That index is derived from the random word revealed onchain, which is fixed
 * before the animation starts and is recomputable by anyone from published data. The
 * animation is a presentation of a result that already exists — it cannot influence, delay or
 * reinterpret it, and with `settledIndex` null it has no result to present and simply turns.
 *
 * Motion is CSS/rAF driven with `prefers-reduced-motion` honoured: with motion reduced the
 * orbit is static and the outcome is presented directly, losing nothing but the flourish.
 */

export type OrbitPhase = 'idle' | 'ready' | 'authorizing' | 'pending' | 'settling' | 'revealed'

export type OrbitMachineProps = {
  assets: RewardAsset[]
  phase: OrbitPhase
  /** Index into `assets` of the winning entry. Null until the outcome is known. */
  settledIndex: number | null
  /** Centre display: the price, before a spin resolves. */
  priceLabel?: string
  /** Optional centre action, rendered as a real button. */
  onActivate?: () => void
  actionLabel?: string
  actionDisabled?: boolean
  /** Compact variant for cards and mobile. */
  size?: 'hero' | 'panel'
  className?: string
}

/** Rotation speed in degrees per second for each phase. */
const PHASE_SPEED: Record<OrbitPhase, number> = {
  idle: 3,
  ready: 6,
  authorizing: 10,
  pending: 40,
  settling: 260,
  revealed: 2,
}

export function OrbitMachine({
  assets,
  phase,
  settledIndex,
  priceLabel,
  onActivate,
  actionLabel,
  actionDisabled,
  size = 'hero',
  className = '',
}: OrbitMachineProps) {
  const reduceMotion = useReducedMotion()
  const [animatedAngle, setAngle] = useState(0)
  const [hovered, setHovered] = useState(false)
  const frame = useRef<number | null>(null)
  const lastTime = useRef<number | null>(null)

  const count = Math.max(assets.length, 1)
  const step = 360 / count

  /** Where the orbit must come to rest for `settledIndex` to sit at the top marker. */
  const targetAngle = useMemo(() => {
    if (settledIndex === null) return null
    return -(settledIndex * step)
  }, [settledIndex, step])

  /**
   * With motion reduced there is no animation at all: the orbit renders straight at its
   * resting position. Derived during render rather than written by an effect, so it costs
   * no extra pass and cannot briefly show the wrong rotation.
   */
  const angle = reduceMotion ? (targetAngle ?? 0) : animatedAngle

  useEffect(() => {
    if (reduceMotion) return

    // Once revealed, decelerate onto the exact target rather than continuing to spin.
    if (phase === 'revealed' && targetAngle !== null) {
      let cancelled = false
      const start = performance.now()
      const from = animatedAngle
      // Land on the nearest equivalent rotation so it never spins backwards.
      const turns = Math.ceil((from - targetAngle) / 360)
      const to = targetAngle + turns * 360
      const duration = 1100

      function settle(now: number) {
        if (cancelled) return
        const t = Math.min((now - start) / duration, 1)
        // Mechanical deceleration: fast, then a long, confident glide to rest.
        const eased = 1 - Math.pow(1 - t, 4)
        setAngle(from + (to - from) * eased)
        if (t < 1) frame.current = requestAnimationFrame(settle)
      }
      frame.current = requestAnimationFrame(settle)
      return () => {
        cancelled = true
        if (frame.current !== null) cancelAnimationFrame(frame.current)
      }
    }

    const speed = PHASE_SPEED[phase] * (hovered && phase === 'ready' ? 2.4 : 1)
    lastTime.current = null

    function tick(now: number) {
      if (lastTime.current !== null) {
        const delta = (now - lastTime.current) / 1000
        setAngle((prev) => (prev + speed * delta) % 360)
      }
      lastTime.current = now
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
    // `animatedAngle` is deliberately excluded: including it would restart the loop on
    // every frame. The deceleration reads it once, as its starting point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, hovered, reduceMotion, targetAngle])

  const dims = size === 'hero' ? {box: 520, track: 196, inner: 138, token: 21} : {box: 320, track: 120, inner: 84, token: 15}

  const settledAsset = settledIndex !== null ? assets[settledIndex] : undefined
  const isSpinning = phase === 'pending' || phase === 'settling'

  return (
    <div
      // overflow-hidden matters: the orbiting-token layer is a rotated square, and a rotated
      // square's bounding box is wider than the square itself. Unclipped it grew the page's
      // scrollWidth by ~50px at phone widths and introduced horizontal page scroll. Every
      // visible element sits well inside the circle, so clipping at the square is lossless.
      className={`relative aspect-square w-full overflow-hidden ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg
        viewBox={`0 0 ${dims.box} ${dims.box}`}
        className="absolute inset-0 size-full"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="orbit-core" cx="50%" cy="42%" r="62%">
            <stop offset="0%" stopColor="var(--color-paper-raised)" />
            <stop offset="72%" stopColor="var(--color-sky-pale)" />
            <stop offset="100%" stopColor="var(--color-powder)" />
          </radialGradient>
          <linearGradient id="orbit-sweep" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-arc)" stopOpacity="0.5" />
            <stop offset="55%" stopColor="var(--color-arc-soft)" stopOpacity="0.14" />
            <stop offset="100%" stopColor="var(--color-peach)" stopOpacity="0.5" />
          </linearGradient>
        </defs>

        {/* Outer registration ring, with tick marks at each token coordinate. */}
        <g transform={`translate(${dims.box / 2} ${dims.box / 2})`}>
          <circle r={dims.track + 42} fill="none" stroke="var(--color-hairline-faint)" strokeWidth="1" />
          <circle r={dims.track + 22} fill="none" stroke="var(--color-hairline)" strokeWidth="1" />

          {/* Coordinate ticks — one per orbital slot. */}
          {Array.from({length: count}).map((_, i) => {
            const a = (i * step - 90) * (Math.PI / 180)
            const r1 = dims.track + 22
            const r2 = dims.track + 32
            return (
              <line
                key={i}
                x1={Math.cos(a) * r1}
                y1={Math.sin(a) * r1}
                x2={Math.cos(a) * r2}
                y2={Math.sin(a) * r2}
                stroke="var(--color-hairline-strong)"
                strokeWidth="1"
              />
            )
          })}

          {/* The track the tokens ride. */}
          <circle r={dims.track} fill="none" stroke="var(--color-hairline)" strokeWidth="1" />

          {/* A single sweeping arc that gives the orbit direction. */}
          <circle
            r={dims.track}
            fill="none"
            stroke="url(#orbit-sweep)"
            strokeWidth={isSpinning ? 2.5 : 1.5}
            strokeLinecap="round"
            strokeDasharray={`${dims.track * 1.5} ${dims.track * 4.8}`}
            style={{
              transform: `rotate(${angle * 1.6}deg)`,
              transition: 'stroke-width 400ms var(--ease-mechanical)',
            }}
          />

          {/* The reward chamber at the centre. */}
          <circle r={dims.inner} fill="url(#orbit-core)" />
          <circle r={dims.inner} fill="none" stroke="var(--color-hairline)" strokeWidth="1" />
          <circle
            r={dims.inner - 14}
            fill="none"
            stroke="var(--color-hairline-faint)"
            strokeWidth="1"
          />

          {/* Top marker: the settle position. */}
          <g transform={`translate(0 ${-(dims.track + 22)})`}>
            <path
              d="M-5 -9 L0 -2 L5 -9"
              fill="none"
              stroke="var(--color-arc)"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </g>
        </g>
      </svg>

      {/* Orbiting tokens, in DOM so logos and labels stay accessible and crisp. */}
      <div
        className="absolute inset-0"
        style={{
          transform: `rotate(${angle}deg)`,
          willChange: reduceMotion ? undefined : 'transform',
        }}
      >
        {assets.map((asset, i) => {
          const a = (i * step - 90) * (Math.PI / 180)
          const radiusPct = (dims.track / dims.box) * 100
          const x = 50 + Math.cos(a) * radiusPct
          const y = 50 + Math.sin(a) * radiusPct
          const isWinner = settledIndex === i && phase === 'revealed'

          return (
            <div
              key={asset.address}
              className="absolute"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                transform: `translate(-50%, -50%) rotate(${-angle}deg)`,
              }}
            >
              <TokenGlyph
                asset={asset}
                size={size === 'hero' ? 42 : 30}
                dim={phase === 'revealed' && !isWinner}
                emphasised={isWinner}
              />
            </div>
          )
        })}
      </div>

      {/* The centre: price, action, or the revealed reward. */}
      <div className="absolute inset-0 grid place-items-center">
        <div
          className="flex flex-col items-center gap-3 text-center"
          style={{width: `${(dims.inner * 1.7 * 100) / dims.box}%`}}
        >
          {phase === 'revealed' && settledAsset ? (
            <RevealedCentre asset={settledAsset} />
          ) : (
            <>
              <span className="micro text-ink-faint">
                {phase === 'pending'
                  ? 'Awaiting randomness'
                  : phase === 'settling'
                    ? 'Settling'
                    : phase === 'authorizing'
                      ? 'Confirm in wallet'
                      : 'Insert'}
              </span>
              {priceLabel ? (
                <span
                  className="font-display text-[clamp(1.5rem,4.2vw,2.5rem)] leading-none text-ink"
                  data-numeric=""
                >
                  {priceLabel}
                </span>
              ) : null}
              {onActivate && actionLabel ? (
                <button
                  type="button"
                  onClick={onActivate}
                  disabled={actionDisabled}
                  className="mt-1 h-10 rounded-[var(--radius-edge)] bg-ink px-5 text-[0.8125rem] font-medium text-paper transition-colors duration-200 hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {actionLabel}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function RevealedCentre({asset}: {asset: RewardAsset}) {
  return (
    <div className="flex flex-col items-center gap-2" style={{animation: 'arcade-rise 700ms var(--ease-settle) both'}}>
      <span className="micro text-arc">Reward found</span>
      <TokenGlyph asset={asset} size={52} emphasised />
      <span className="font-display text-[1.5rem] leading-none text-ink">{labelFor(asset)}</span>
    </div>
  )
}

/**
 * A token glyph.
 *
 * Renders the project's real published logo when one exists, and a typographic monogram when
 * it does not. Arcade never generates or approximates an existing project's mark: on a chain
 * where several tokens share a ticker, a plausible-looking fake logo invites someone to trust
 * the wrong asset. An honest monogram is the better failure.
 *
 * The runtime `onError` fallback matters too — if a logo file ever goes missing, the glyph
 * degrades to the monogram rather than showing a broken image.
 */
export function TokenGlyph({
  asset,
  size = 32,
  dim = false,
  emphasised = false,
}: {
  asset: Pick<RewardAsset, 'symbol' | 'logoUri' | 'address'>
  size?: number
  dim?: boolean
  emphasised?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const initials = labelFor(asset).replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase() || '?'
  const showLogo = Boolean(asset.logoUri) && !failed

  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full border bg-paper-raised transition-all duration-500 ${
        emphasised ? 'border-arc/50' : 'border-hairline'
      }`}
      style={{
        width: size,
        height: size,
        opacity: dim ? 0.24 : 1,
        transform: emphasised ? 'scale(1.06)' : undefined,
        boxShadow: emphasised ? '0 0 0 4px color-mix(in srgb, var(--color-arc) 10%, transparent)' : undefined,
      }}
      title={labelFor(asset)}
    >
      {showLogo ? (
        <Image
          src={asset.logoUri as string}
          alt=""
          width={size}
          height={size}
          onError={() => setFailed(true)}
          className="size-full object-cover"
          unoptimized
        />
      ) : (
        <span
          className="font-mono font-medium text-ink-soft"
          style={{fontSize: Math.max(8, size * 0.3), letterSpacing: '0.02em'}}
          aria-hidden="true"
        >
          {initials}
        </span>
      )}
    </span>
  )
}
