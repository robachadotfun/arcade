import Image from 'next/image'
import manifest from '../../public/generated/manifest.json'

/**
 * Generated isometric artwork.
 *
 * Assets come from `scripts/generate-arcade-art.ts` and are recorded in
 * `public/generated/manifest.json` together with the prompt that produced them.
 *
 * ## How these sit on the page
 *
 * The illustrations are drawn on their own near-white ground, which is close to — but not
 * exactly — the page's ivory. Framing them in a bordered box made that seam obvious and made
 * them read as stock images dropped into slots.
 *
 * So there is no frame and no panel. Each one renders at its **natural aspect ratio** with
 * `mix-blend-mode: multiply`, which makes its light ground fall away against whatever the page
 * background is while the drawn object keeps its shading. The result is an illustration
 * sitting *on* the paper rather than in a window cut into it.
 *
 * Consequences worth knowing:
 *   - No cropping. An asset's own proportions decide its height, so layouts have to tolerate
 *     that rather than force it into a band.
 *   - `multiply` only behaves against a light background. Every page here is ivory, which is
 *     the assumption; on a dark surface it would go muddy.
 *
 * ## Two rules
 *
 * 1. **Art is atmosphere, never structure.** Every functional visual — the orbit machine, the
 *    hero geometry, the fairness diagram, the odds rail — is hand-drawn SVG. If the art pack
 *    is missing, these components render nothing and the page still reads correctly. Nothing
 *    a user needs is locked inside a generated image.
 * 2. **It is decorative, so it is hidden from assistive technology.** These images carry no
 *    information that is not already in the surrounding text, so they take an empty `alt`
 *    rather than a description that would just add noise to a screen reader.
 */

type ArtEntry = {name: string; file: string; size: string; usage: string}

const ART: Record<string, ArtEntry> = Object.fromEntries(
  (manifest.assets as ArtEntry[]).map((entry) => [entry.name, entry]),
)

export type ArtName =
  | 'hero-orbit'
  | 'genesis-machine'
  | 'velocity-machine'
  | 'bluechip-machine'
  | 'discovery-machine'
  | 'machine-zero'
  | 'fairness-commitment'
  | 'fairness-reveal'
  | 'reward-chamber'
  | 'rewards-array'
  | 'vault'
  | 'rarity-common'
  | 'rarity-rare'
  | 'rarity-ultra'
  | 'rarity-jackpot'
  | 'empty-tape'
  | 'empty-wallet'
  | 'settlement'
  | 'verification'
  | 'treasury'
  | 'network-arc'

/** Is this asset present? Lets a caller lay out differently rather than leave a gap. */
export function hasArt(name: ArtName): boolean {
  return Boolean(ART[name])
}

/** Parses the manifest's `"1536x1024"` into intrinsic dimensions. */
function dimensions(entry: ArtEntry): {width: number; height: number} {
  const parts = entry.size.split('x').map((n) => Number.parseInt(n, 10))
  const width = parts[0]
  const height = parts[1]
  if (Number.isFinite(width) && Number.isFinite(height) && width && height) {
    return {width, height}
  }
  return {width: 1024, height: 1024}
}

/**
 * An isometric illustration, blended into the page background.
 *
 * Renders at its natural aspect ratio — no frame, no fixed box, no crop.
 */
export function ArcadeArt({
  name,
  className = '',
  sizes = '(min-width: 1024px) 50vw, 100vw',
  priority = false,
  caption,
}: {
  name: ArtName
  className?: string
  sizes?: string
  priority?: boolean
  caption?: string
}) {
  const entry = ART[name]
  if (!entry) return null

  const {width, height} = dimensions(entry)

  return (
    <figure className={className}>
      <Image
        src={`/generated/${entry.file}`}
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        sizes={sizes}
        priority={priority}
        className="h-auto w-full"
        // multiply drops the illustration's own light ground out against the page ivory, so
        // it reads as drawn on the paper instead of pasted into a box.
        style={{mixBlendMode: 'multiply'}}
      />
      {caption ? (
        <figcaption className="text-[0.8125rem] leading-relaxed text-ink-muted">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}

/** Maps a machine slug to its illustration, so callers do not hard-code asset names. */
export const MACHINE_ART: Record<string, ArtName> = {
  genesis: 'genesis-machine',
  velocity: 'velocity-machine',
  'blue-chip': 'bluechip-machine',
  discovery: 'discovery-machine',
  'machine-zero': 'machine-zero',
}

/** Maps a rarity band to its illustration. */
export const RARITY_ART: Record<string, ArtName> = {
  common: 'rarity-common',
  rare: 'rarity-rare',
  ultra: 'rarity-ultra',
  jackpot: 'rarity-jackpot',
}
