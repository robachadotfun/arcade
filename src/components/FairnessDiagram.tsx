/**
 * The fairness mechanism, as a single technical line drawing.
 *
 * Five stages on one rail, with the commitment shown as a sealed box that predates the
 * spin — which is the whole point of the construction. Deliberately one continuous diagram
 * rather than five cards, in Arc's drawn-schematic idiom.
 *
 * Server component: no JS, and the text alternative carries the same information for
 * anyone who cannot see the drawing.
 */

const STAGES = [
  {
    key: 'pay',
    title: 'Pay',
    detail: 'One signature in native USDC. Price, machine and version are frozen into the spin.',
  },
  {
    key: 'lock',
    title: 'Lock',
    detail: 'The next pre-published commitment is consumed, bound to you and to a future block.',
  },
  {
    key: 'randomize',
    title: 'Randomize',
    detail: 'The sealed seed is revealed and hashed with the request entropy and anchor blockhash.',
  },
  {
    key: 'settle',
    title: 'Settle',
    detail: 'The band and amount are derived, reserved in the vault, and sent to your wallet.',
  },
  {
    key: 'verify',
    title: 'Verify',
    detail: 'Every input is public. Recompute the word yourself, or ask the contract to.',
  },
]

export function FairnessDiagram() {
  return (
    <div>
      {/* The commitment, published ahead of everything else. */}
      <div className="mb-10 flex items-start gap-4">
        <svg viewBox="0 0 40 40" className="mt-0.5 size-9 shrink-0" fill="none" aria-hidden="true">
          <rect x="6" y="10" width="28" height="22" stroke="var(--color-hairline-strong)" strokeWidth="1" />
          <path d="M6 16h28" stroke="var(--color-hairline)" strokeWidth="1" />
          <circle cx="20" cy="24" r="4" stroke="var(--color-arc)" strokeWidth="1.2" />
          <path d="M20 6v4" stroke="var(--color-hairline-strong)" strokeWidth="1" />
        </svg>
        <div>
          <p className="label text-arc">Before any spin exists</p>
          <p className="mt-2 max-w-[60ch] text-[0.9375rem] leading-relaxed text-ink-soft">
            The operator publishes a batch of commitments — each one{' '}
            <code className="font-mono text-[0.8125rem]">keccak256(seed, salt)</code> — onchain.
            They are consumed in strict ascending order, one per spin, exactly once. A seed that
            already exists cannot be adapted to an outcome that has not happened yet.
          </p>
        </div>
      </div>

      {/* The rail. */}
      <div className="relative">
        <div
          aria-hidden="true"
          className="absolute top-[9px] left-0 hidden h-px w-full bg-hairline md:block"
        />

        <ol className="grid gap-10 md:grid-cols-5 md:gap-5">
          {STAGES.map((stage, i) => (
            <li key={stage.key} className="relative">
              <div className="flex items-center gap-3 md:block">
                <span
                  aria-hidden="true"
                  className="relative z-10 block size-[19px] shrink-0 rounded-full border border-hairline-strong bg-paper"
                >
                  <span
                    className={`absolute inset-[5px] rounded-full ${
                      i === 2 ? 'bg-arc' : 'bg-ink-faint'
                    }`}
                  />
                </span>
                <span className="micro text-ink-faint md:mt-4 md:block">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <h3 className="mt-3 font-display text-[1.25rem] leading-tight text-ink md:mt-1.5">
                {stage.title}
              </h3>
              <p className="mt-2 max-w-[30ch] text-[0.875rem] leading-relaxed text-ink-muted">
                {stage.detail}
              </p>

              {i < STAGES.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute top-[26px] left-[9px] h-[calc(100%+1.5rem)] w-px bg-hairline md:hidden"
                />
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      {/* The formula, as a drawn artefact rather than body text. */}
      <figure className="mt-14 border border-hairline bg-paper-deep/40 p-6 md:p-8">
        <figcaption className="label text-ink-faint">The derivation</figcaption>
        <pre className="mt-5 overflow-x-auto font-mono text-[0.8125rem] leading-relaxed text-ink">
          <code>
            {`randomWord = keccak256(
    seed,                      // sealed before your spin, revealed after
    salt,                      // sealed with it
    requestEntropy,            // your address, spin id, machine version, config hash
    blockhash(anchorBlock)     // a block that did not exist when you signed
)

tierIndex  = keccak256(randomWord, "tier")   % totalWeight   -> weighted band
amount     = keccak256(randomWord, "amount") % (span + 1)    -> within the band`}
          </code>
        </pre>
        <p className="mt-5 max-w-[68ch] text-[0.875rem] leading-relaxed text-ink-muted">
          The band and the amount are drawn from independent domains of the same word, so they
          are uncorrelated. Both are pure functions of public data, which is why settlement is
          permissionless: whoever calls it, the answer is identical.
        </p>
      </figure>
    </div>
  )
}
