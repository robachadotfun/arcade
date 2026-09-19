/**
 * The Arcade identity mark.
 *
 * Two sweeping arcs that meet at an apex and are crossed by a hairline bar: an "A" read as
 * a portal. The left arc opens, the right arc closes, and the small node at the apex is the
 * settled reward at the centre of an orbit — the "value moves through an arc" motif that runs
 * through the whole product.
 *
 * Drawn from scratch. It is not derived from, and does not modify, Arc's official logo.
 */
export function ArcadeMark({
  className,
  size = 28,
  title,
}: {
  className?: string
  size?: number
  title?: string
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="none"
    >
      {/* Left arc: the opening sweep. */}
      <path
        d="M4 28C4 15.8 9.4 5.5 16 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Right arc: the closing sweep, slightly lighter so the form has direction. */}
      <path
        d="M28 28C28 15.8 22.6 5.5 16 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* The crossbar of the A, kept as a true hairline. */}
      <path d="M9.2 20.5H22.8" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      {/* The settled reward at the apex. */}
      <circle cx="16" cy="3" r="2.1" fill="currentColor" />
    </svg>
  )
}

/** Wordmark plus symbol, for the header and footer. */
export function ArcadeLogo({className, markSize = 26}: {className?: string; markSize?: number}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <ArcadeMark size={markSize} title="Arcade" />
      <span
        className="font-display text-[1.375rem] leading-none tracking-[-0.02em]"
        style={{fontVariationSettings: "'SOFT' 20, 'WONK' 0"}}
      >
        Arcade
      </span>
    </span>
  )
}
