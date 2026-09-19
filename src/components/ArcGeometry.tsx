/**
 * The Arc-native geometric layer.
 *
 * Ultra-thin orbital paths, partial circles, coordinate lines and small nodes that run
 * behind and occasionally *across* sections rather than sitting politely inside a container.
 * Purely decorative, so everything here is `aria-hidden` and pointer-transparent.
 */

/** Large orbital arcs behind the hero. Deliberately extends past the viewport edges. */
export function HeroGeometry({className = ''}: {className?: string}) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden="true">
      {/* Warm-to-cool wash. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 78% 8%, var(--color-sky-pale) 0%, transparent 55%), radial-gradient(90% 70% at 12% 92%, var(--color-cream) 0%, transparent 60%)',
        }}
      />

      <svg
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full"
        fill="none"
      >
        <g stroke="var(--color-hairline)" strokeWidth="1">
          {/* Giant orbital paths, centred off-canvas to the right. */}
          <circle cx="1240" cy="380" r="560" />
          <circle cx="1240" cy="380" r="420" stroke="var(--color-hairline-faint)" />
          <circle cx="1240" cy="380" r="700" stroke="var(--color-hairline-faint)" />
          {/* A sweeping partial arc crossing the full width. */}
          <path d="M-120 760 C 340 700, 760 520, 1080 180" />
          <path d="M-120 840 C 420 800, 900 640, 1300 240" stroke="var(--color-hairline-faint)" />
        </g>

        {/* Coordinate lines. */}
        <g stroke="var(--color-hairline-faint)" strokeWidth="1">
          <line x1="0" y1="212" x2="1600" y2="212" />
          <line x1="0" y1="688" x2="1600" y2="688" />
          <line x1="196" y1="0" x2="196" y2="900" />
          <line x1="1404" y1="0" x2="1404" y2="900" />
        </g>

        {/* Registration marks at the intersections. */}
        <g stroke="var(--color-hairline-strong)" strokeWidth="1">
          {[
            [196, 212],
            [1404, 212],
            [196, 688],
            [1404, 688],
          ].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <line x1={(x as number) - 5} y1={y as number} x2={(x as number) + 5} y2={y as number} />
              <line x1={x as number} y1={(y as number) - 5} x2={x as number} y2={(y as number) + 5} />
            </g>
          ))}
        </g>

        {/* Nodes along the arcs. */}
        <g fill="var(--color-arc-soft)">
          <circle cx="1080" cy="180" r="2.5" />
          <circle cx="760" cy="520" r="2" opacity="0.6" />
          <circle cx="340" cy="700" r="2" opacity="0.4" />
        </g>
      </svg>
    </div>
  )
}

/**
 * A hairline that travels across a section boundary, so the page reads as one continuous
 * drawing rather than a stack of independent blocks.
 */
export function CrossingArc({
  className = '',
  flip = false,
}: {
  className?: string
  flip?: boolean
}) {
  return (
    <div className={`pointer-events-none absolute inset-x-0 ${className}`} aria-hidden="true">
      <svg viewBox="0 0 1600 240" className="w-full" fill="none" preserveAspectRatio="none">
        <path
          d={flip ? 'M0 200 C 400 40, 1200 40, 1600 200' : 'M0 40 C 400 200, 1200 200, 1600 40'}
          stroke="var(--color-hairline)"
          strokeWidth="1"
        />
        <path
          d={flip ? 'M0 230 C 400 80, 1200 80, 1600 230' : 'M0 10 C 400 170, 1200 170, 1600 10'}
          stroke="var(--color-hairline-faint)"
          strokeWidth="1"
        />
      </svg>
    </div>
  )
}

/**
 * The "four steps" diagram: one thin horizontal technical drawing rather than four cards.
 */
export function StepDiagram({
  steps,
}: {
  steps: ReadonlyArray<{index: string; title: string; detail: string}>
}) {
  return (
    <div className="relative">
      {/* The rail the nodes sit on. */}
      <div
        aria-hidden="true"
        className="absolute top-[7px] left-0 hidden h-px w-full bg-hairline md:block"
      />
      <ol className="grid gap-10 md:grid-cols-4 md:gap-6">
        {steps.map((step, i) => (
          <li key={step.index} className="relative">
            <div className="flex items-center gap-3 md:block">
              {/* Node */}
              <span
                aria-hidden="true"
                className="relative z-10 block size-[15px] shrink-0 rounded-full border border-hairline-strong bg-paper"
              >
                <span className="absolute inset-[4px] rounded-full bg-arc" />
              </span>
              <span className="micro mt-0 text-ink-faint md:mt-5 md:block">{step.index}</span>
            </div>
            <h3 className="mt-3 font-display text-[1.375rem] leading-tight text-ink md:mt-2">
              {step.title}
            </h3>
            <p className="mt-2 max-w-[28ch] text-[0.9375rem] leading-relaxed text-ink-muted">
              {step.detail}
            </p>
            {/* Vertical connector on mobile, where the horizontal rail is hidden. */}
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-[22px] left-[7px] h-[calc(100%+1.5rem)] w-px bg-hairline md:hidden"
              />
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}
