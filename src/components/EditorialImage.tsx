import Image from 'next/image'
import attribution from '../../public/media/media-attribution.json'

/**
 * A photograph used as an editorial accent, with its licence credit rendered alongside it.
 *
 * Credits come from `public/media/media-attribution.json`, which
 * `scripts/fetch-media.ts` generates by reading licence metadata straight from the source
 * API. The component refuses to render an image with no attribution record — under CC BY the
 * credit is a licence condition, not a nicety, so an unattributed render would be a breach.
 *
 * Photography is deliberately sparing here. The product's visual identity is its drawn
 * geometry; these images are punctuation.
 *
 * ## Edges
 *
 * A photograph cannot be blended into the page the way the isometric illustrations are — it
 * has real tone everywhere, so `multiply` would just darken it. Instead its edges are masked
 * so they fall away into the paper rather than stopping at a hard rectangle, and it is
 * desaturated toward the ivory palette. No border, no panel: the intent is a plate lying on
 * the page, not a window cut into it.
 */

type MediaRecord = {
  filename: string
  title: string
  creator: string
  license: string
  licenseUrl: string | null
  sourceUrl: string
}

const MEDIA = attribution.media as MediaRecord[]

/** `machined-ring.webp` -> `machined-ring`. */
function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
}

/**
 * Photograph keys, without a file extension.
 *
 * `pnpm optimize:images` rewrites the stored filename from `.jpg` to `.webp`, so anything
 * keyed on the full filename breaks the moment optimisation runs. The basename is stable.
 */
export type EditorialImageName = 'machined-ring' | 'architecture-curve'

export function EditorialImage({
  name,
  alt,
  caption,
  aspect = '4 / 3',
  priority = false,
  className = '',
  sizes = '(min-width: 1024px) 40vw, 100vw',
}: {
  name: EditorialImageName
  /** Describe what is depicted. Never leave this to the filename. */
  alt: string
  /** Editorial caption. The credit line is appended automatically. */
  caption?: string
  aspect?: string
  priority?: boolean
  className?: string
  sizes?: string
}) {
  const record = MEDIA.find((item) => stripExtension(item.filename) === name)

  // A missing record means the media fetch has not run. Render nothing rather than an
  // unattributed image or a broken frame.
  if (!record) return null

  return (
    <figure className={className}>
      <div className="relative w-full overflow-hidden" style={{aspectRatio: aspect}}>
        <Image
          src={`/media/${record.filename}`}
          alt={alt}
          fill
          priority={priority}
          sizes={sizes}
          className="object-cover"
          style={{
            // Pulled toward the ivory palette rather than left fighting it, and feathered at
            // every edge so the frame dissolves instead of stopping abruptly.
            filter: 'saturate(0.7) contrast(0.98) brightness(1.04)',
            maskImage:
              'radial-gradient(ellipse 96% 96% at 50% 50%, black 55%, transparent 100%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 96% 96% at 50% 50%, black 55%, transparent 100%)',
          }}
        />
      </div>
      <figcaption className="mt-3 flex flex-col gap-1">
        {caption ? (
          <span className="text-[0.8125rem] leading-relaxed text-ink-muted">{caption}</span>
        ) : null}
        <span className="micro text-ink-faint">
          {record.title} · {record.creator} ·{' '}
          {record.licenseUrl ? (
            <a
              href={record.licenseUrl}
              target="_blank"
              rel="noopener noreferrer license"
              className="underline decoration-ink-faint/40 underline-offset-2 hover:text-ink-muted"
            >
              {record.license}
            </a>
          ) : (
            record.license
          )}{' '}
          ·{' '}
          <a
            href={record.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-ink-faint/40 underline-offset-2 hover:text-ink-muted"
          >
            source
          </a>
        </span>
      </figcaption>
    </figure>
  )
}

/** The full credits list, rendered on the contracts/transparency page. */
export function MediaCredits({className = ''}: {className?: string}) {
  if (MEDIA.length === 0) return null

  return (
    <dl className={`divide-y divide-hairline-faint border-y border-hairline-faint ${className}`}>
      {MEDIA.map((record) => (
        <div key={record.filename} className="py-3">
          <dt className="text-[0.875rem] text-ink">{record.title}</dt>
          <dd className="mt-1 text-[0.75rem] leading-relaxed text-ink-muted">
            {record.creator} ·{' '}
            {record.licenseUrl ? (
              <a
                href={record.licenseUrl}
                target="_blank"
                rel="noopener noreferrer license"
                className="text-arc underline underline-offset-2"
              >
                {record.license}
              </a>
            ) : (
              record.license
            )}{' '}
            ·{' '}
            <a
              href={record.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-arc underline underline-offset-2"
            >
              Wikimedia Commons
            </a>
          </dd>
        </div>
      ))}
    </dl>
  )
}
