import Image from 'next/image'
import mark from '../../public/brand/arcade-mark.webp'

/**
 * The Arcade identity mark.
 *
 * The artwork is `public/brand/arcade-mark.webp`, used byte-for-byte as supplied — an "A"
 * whose two strokes are a single folded ribbon, with a sphere resting at its centre and an
 * orbit passing through, on a soft ivory disc with registration ticks at the four compass
 * points. It is rendered, never redrawn: nothing here recolours, recrops or re-encodes it.
 *
 * ## Why the whole square, disc and all
 *
 * The obvious alternative is to bound the layout box on the letter and let the rest bleed, so
 * the "A" optically matches the wordmark's cap height. That was tried and it is wrong: the
 * header is `bg-paper/85` over a blur, so its background is translucent, and the artwork's
 * opaque disc then reads as a pale circle floating behind the letter — with a visible rim.
 *
 * The disc is not stray background. It is part of the composition, which is an icon: the whole
 * square is placed as a badge, and the circle becomes deliberate instead of accidental. This
 * also makes `size` mean the plain thing — the rendered size of the image.
 *
 * ## Why `unoptimized`
 *
 * The file has a transparent margin. Next's image optimiser picks its output format from the
 * request's `Accept` header, and its JPEG fallback — what anything not negotiating WebP gets —
 * has no alpha, so it flattens that margin to **solid black**: a black square behind the logo.
 * Serving the original is also the only way to guarantee the mark is the supplied artwork and
 * not a re-encode of it. One 141 KB file, hashed and immutably cached, shared by the header and
 * the footer across every page.
 */
export function ArcadeMark({
  className,
  size = 40,
  title,
}: {
  className?: string
  /** Rendered edge length of the square artwork, in pixels. */
  size?: number
  title?: string
}) {
  return (
    <Image
      src={mark}
      alt={title ?? ''}
      aria-hidden={title ? undefined : true}
      width={size}
      height={size}
      className={className}
      priority
      unoptimized
      style={{width: size, height: size, flexShrink: 0}}
    />
  )
}

/**
 * Wordmark plus symbol, for the header and footer.
 *
 * The badge is set a little taller than the wordmark's cap height, which is how a disc-shaped
 * mark sits level with type — matching the heights instead would leave the disc looking small.
 */
export function ArcadeLogo({className, markSize = 42}: {className?: string; markSize?: number}) {
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
