import {TokenGlyph} from './OrbitMachine'
import type {RewardAsset} from '@/config/rewards'

/**
 * A server-rendered orbit.
 *
 * The same visual language as {@link OrbitMachine}, but with no state and no JavaScript: the
 * slow rotation is a CSS animation, so this can render inside a server component and costs
 * the client bundle nothing. Used wherever the orbit is decoration rather than interaction.
 */
export function StaticOrbit({
  assets,
  centreLabel,
  centreValue,
  className = '',
}: {
  assets: RewardAsset[]
  centreLabel?: string
  centreValue?: string
  className?: string
}) {
  const count = Math.max(assets.length, 1)
  const step = 360 / count
  const box = 400
  const track = 148
  const inner = 104

  return (
    <div className={`relative aspect-square w-full ${className}`}>
      <svg viewBox={`0 0 ${box} ${box}`} className="absolute inset-0 size-full" aria-hidden="true" fill="none">
        <defs>
          <radialGradient id="static-orbit-core" cx="50%" cy="42%" r="62%">
            <stop offset="0%" stopColor="var(--color-paper-raised)" />
            <stop offset="74%" stopColor="var(--color-sky-pale)" />
            <stop offset="100%" stopColor="var(--color-powder)" />
          </radialGradient>
        </defs>

        <g transform={`translate(${box / 2} ${box / 2})`}>
          <circle r={track + 34} fill="none" stroke="var(--color-hairline-faint)" strokeWidth="1" />
          <circle r={track + 18} fill="none" stroke="var(--color-hairline)" strokeWidth="1" />
          <circle r={track} fill="none" stroke="var(--color-hairline)" strokeWidth="1" />

          {/* Coordinate ticks at each slot. */}
          {Array.from({length: count}).map((_, i) => {
            const a = (i * step - 90) * (Math.PI / 180)
            return (
              <line
                key={i}
                x1={Math.cos(a) * (track + 18)}
                y1={Math.sin(a) * (track + 18)}
                x2={Math.cos(a) * (track + 27)}
                y2={Math.sin(a) * (track + 27)}
                stroke="var(--color-hairline-strong)"
                strokeWidth="1"
              />
            )
          })}

          {/* The slow sweep, driven purely by CSS. */}
          <g className="orbit-slow">
            <circle
              r={track}
              fill="none"
              stroke="var(--color-arc-soft)"
              strokeOpacity="0.4"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray={`${track * 1.3} ${track * 5}`}
            />
          </g>
          <g className="orbit-slower">
            <circle
              r={track + 34}
              fill="none"
              stroke="var(--color-peach)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray={`${track * 0.6} ${track * 6}`}
            />
          </g>

          <circle r={inner} fill="url(#static-orbit-core)" />
          <circle r={inner} fill="none" stroke="var(--color-hairline)" strokeWidth="1" />
          <circle r={inner - 12} fill="none" stroke="var(--color-hairline-faint)" strokeWidth="1" />
        </g>
      </svg>

      {assets.map((asset, i) => {
        const a = (i * step - 90) * (Math.PI / 180)
        const radiusPct = (track / box) * 100
        return (
          <div
            key={asset.address}
            className="absolute"
            style={{
              left: `${50 + Math.cos(a) * radiusPct}%`,
              top: `${50 + Math.sin(a) * radiusPct}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <TokenGlyph asset={asset} size={34} />
          </div>
        )
      })}

      {centreLabel || centreValue ? (
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            {centreLabel ? <p className="micro text-ink-faint">{centreLabel}</p> : null}
            {centreValue ? (
              <p className="mt-1.5 font-display text-[1.75rem] leading-none text-ink" data-numeric="">
                {centreValue}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
