import {RARITY_LABEL, type Rarity, type RarityOdds} from '@/config/machines'
import {formatPercent} from '@/lib/format'

/**
 * The probability rail.
 *
 * A single thin horizontal bar rather than a chart. Each band carries a distinct fill
 * *pattern* as well as a distinct tone, and every segment is labelled with its name and
 * percentage in text — so rarity is never conveyed by colour alone.
 */

const RARITY_FILL: Record<Rarity, string> = {
  common: 'var(--color-powder)',
  rare: 'var(--color-arc-soft)',
  ultra: 'var(--color-peach)',
  jackpot: 'var(--color-arc)',
}

/** Distinguishing pattern per band, for colour-blind and monochrome readability. */
const RARITY_PATTERN: Record<Rarity, string | null> = {
  common: null,
  rare: 'rail-hatch',
  ultra: 'rail-dots',
  jackpot: 'rail-dense',
}

export function OddsRail({
  odds,
  height = 10,
  showLegend = true,
  className = '',
}: {
  odds: RarityOdds[]
  height?: number
  showLegend?: boolean
  className?: string
}) {
  const total = odds.reduce((sum, o) => sum + o.probability, 0)

  return (
    <div className={className}>
      <svg width="0" height="0" aria-hidden="true" className="absolute">
        <defs>
          <pattern id="rail-hatch" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill="var(--color-arc-soft)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--color-paper)" strokeWidth="1.6" />
          </pattern>
          <pattern id="rail-dots" width="5" height="5" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill="var(--color-peach)" />
            <circle cx="2.5" cy="2.5" r="1" fill="var(--color-paper)" />
          </pattern>
          <pattern id="rail-dense" width="4" height="4" patternTransform="rotate(-45)" patternUnits="userSpaceOnUse">
            <rect width="4" height="4" fill="var(--color-arc)" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--color-paper)" strokeWidth="1" />
          </pattern>
        </defs>
      </svg>

      <div
        role="img"
        aria-label={`Probability distribution: ${odds
          .map((o) => `${RARITY_LABEL[o.rarity]} ${formatPercent(o.probability)}`)
          .join(', ')}`}
        className="flex w-full overflow-hidden border border-hairline"
        style={{height}}
      >
        {odds.map((band) => {
          const pattern = RARITY_PATTERN[band.rarity]
          const width = total === 0 ? 0 : (band.probability / total) * 100
          return (
            <span
              key={band.rarity}
              className="relative block h-full"
              style={{
                width: `${width}%`,
                background: pattern ? `url(#${pattern})` : RARITY_FILL[band.rarity],
                backgroundColor: RARITY_FILL[band.rarity],
              }}
            />
          )
        })}
      </div>

      {showLegend ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-8">
          {odds.map((band) => (
            <div key={band.rarity} className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 border border-hairline-strong"
                style={{backgroundColor: RARITY_FILL[band.rarity]}}
              />
              <dt className="label text-ink-faint">{RARITY_LABEL[band.rarity]}</dt>
              <dd className="font-mono text-[0.8125rem] text-ink" data-numeric="">
                {formatPercent(band.probability)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

/**
 * A rarity tag. Shape and label differ per band as well as tone, so the band is readable
 * without colour.
 */
export function RarityTag({rarity, className = ''}: {rarity: Rarity; className?: string}) {
  const styles: Record<Rarity, string> = {
    common: 'border-hairline-strong text-ink-muted',
    rare: 'border-arc-soft/50 text-arc-deep',
    ultra: 'border-signal-warn/40 text-signal-warn',
    jackpot: 'border-arc bg-arc/8 text-arc-deep',
  }
  const marks: Record<Rarity, string> = {
    common: '·',
    rare: '··',
    ultra: '···',
    jackpot: '★',
  }
  return (
    <span className={`micro inline-flex items-center gap-1.5 border px-2 py-0.5 ${styles[rarity]} ${className}`}>
      <span aria-hidden="true">{marks[rarity]}</span>
      {RARITY_LABEL[rarity]}
    </span>
  )
}
