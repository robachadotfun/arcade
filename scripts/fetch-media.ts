/**
 * fetch-media.ts
 *
 * Downloads the small set of real photographs used as editorial accents, and writes
 * `public/media/media-attribution.json`.
 *
 * ## Why attribution is fetched, not typed
 *
 * Licence terms and author credits are read from the Wikimedia Commons API at download time
 * and written verbatim into the manifest. Transcribing them by hand is how attributions end
 * up subtly wrong, and a wrong credit on a CC BY image is a licence breach rather than a
 * typo. If the API does not return a licence for a file, the script refuses to save it.
 *
 * Every file here is Creative Commons or public domain, permits commercial use, and is used
 * unmodified apart from display sizing. Attribution is rendered in the UI next to the image
 * and recorded in the manifest.
 *
 * Usage: pnpm fetch:media
 */

import {mkdirSync, writeFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(HERE, '../public/media')
const MANIFEST_PATH = resolve(OUT_DIR, 'media-attribution.json')

const API = 'https://commons.wikimedia.org/w/api.php'
const USER_AGENT = 'ArcadeBuild/1.0 (build-time media fetch; https://github.com/)'

/** Licences we accept: attribution-only or share-alike, all commercial-use permitted. */
const ALLOWED_LICENCE_PATTERN = /^(CC BY(-SA)? [0-9.]+|CC0|Public domain|No restrictions|PDM)/i

type MediaItem = {
  /** Local filename written into public/media. */
  filename: string
  /** Exact Commons file title. */
  commonsTitle: string
  /** Where Arcade uses it. */
  usage: string
  /** Why it fits the art direction. */
  subject: string
  /** Max width to download; Commons renders a thumbnail at this size. */
  width: number
}

const MEDIA: MediaItem[] = [
  {
    filename: 'architecture-curve.jpg',
    commonsTitle: 'File:Oculus Interior 252.jpg',
    usage: 'Editorial accent — architectural curves, used beside the fairness mechanism.',
    subject: 'White ribbed architectural vault: thin repeating curves against pale light.',
    width: 2000,
  },
  {
    filename: 'machined-ring.jpg',
    commonsTitle:
      'File:Air intake, fan and compressor of sectioned Rolls-Royce Turboméca Adour turbofan 01.jpg',
    usage: 'Editorial accent — precision circular machinery, used beside machine detail.',
    subject: 'A sectioned turbofan: a precisely machined circular component, head-on.',
    width: 2000,
  },
]

type ExtMetadataField = {value?: string}

type ImageInfo = {
  thumburl?: string
  url?: string
  descriptionurl?: string
  width?: number
  height?: number
  mime?: string
  extmetadata?: Record<string, ExtMetadataField>
}

type ApiResponse = {
  query?: {pages?: Record<string, {title?: string; imageinfo?: ImageInfo[]}>}
}

/** Strips the HTML Commons returns in metadata fields. */
function plain(value: string | undefined): string | null {
  if (!value) return null
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 0 ? text : null
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Polite, retrying fetch.
 *
 * Wikimedia rate-limits aggressively and answers 429 rather than queuing. Retrying with
 * backoff and spacing requests out is the difference between a script that works and one
 * that silently produces an empty manifest.
 */
async function politeFetch(url: URL | string, attempts = 5): Promise<Response> {
  let lastStatus = 0
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const res = await fetch(url, {
      headers: {'user-agent': USER_AGENT, 'accept-encoding': 'gzip'},
      signal: AbortSignal.timeout(120_000),
    })
    if (res.ok) return res

    lastStatus = res.status
    // 429 and 5xx are worth waiting out; anything else is a real error.
    if (res.status !== 429 && res.status < 500) return res
    const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10)
    const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2_000 * 2 ** (attempt - 1)
    process.stdout.write(`(HTTP ${res.status}, waiting ${Math.round(waitMs / 1000)}s) `)
    await sleep(waitMs)
  }
  throw new Error(`HTTP ${lastStatus} after ${attempts} attempts`)
}

async function fetchInfo(title: string, width: number): Promise<ImageInfo> {
  const url = new URL(API)
  url.searchParams.set('action', 'query')
  url.searchParams.set('format', 'json')
  url.searchParams.set('titles', title)
  url.searchParams.set('prop', 'imageinfo')
  url.searchParams.set('iiprop', 'url|extmetadata|size|mime')
  url.searchParams.set('iiurlwidth', String(width))

  const res = await politeFetch(url)
  if (!res.ok) throw new Error(`Commons API HTTP ${res.status} for ${title}`)

  const json = (await res.json()) as ApiResponse
  const pages = json.query?.pages ?? {}
  const page = Object.values(pages)[0]
  const info = page?.imageinfo?.[0]
  if (!info) throw new Error(`No image info returned for ${title}`)
  return info
}

async function main() {
  mkdirSync(OUT_DIR, {recursive: true})
  process.stdout.write(`Arcade media fetch\nitems: ${MEDIA.length}\n\n`)

  const records: unknown[] = []
  const failures: string[] = []

  for (const item of MEDIA) {
    process.stdout.write(`. ${item.filename} `)
    try {
      const info = await fetchInfo(item.commonsTitle, item.width)
      const meta = info.extmetadata ?? {}

      const licenceShort = plain(meta.LicenseShortName?.value)
      const licenceUrl = plain(meta.LicenseUrl?.value)
      const artist = plain(meta.Artist?.value)
      const credit = plain(meta.Credit?.value)
      const title = plain(meta.ObjectName?.value) ?? item.commonsTitle.replace(/^File:/, '')

      if (!licenceShort) {
        throw new Error('Commons returned no licence for this file — refusing to save it.')
      }
      if (!ALLOWED_LICENCE_PATTERN.test(licenceShort)) {
        throw new Error(
          `Licence "${licenceShort}" is not on the accepted list. Refusing to save it.`,
        )
      }
      if (!artist) {
        throw new Error('Commons returned no author — an attribution licence needs one.')
      }

      const downloadUrl = info.thumburl ?? info.url
      if (!downloadUrl) throw new Error('No downloadable URL returned')

      const image = await politeFetch(downloadUrl)
      if (!image.ok) throw new Error(`Download HTTP ${image.status}`)

      const bytes = Buffer.from(await image.arrayBuffer())
      writeFileSync(resolve(OUT_DIR, item.filename), bytes)

      records.push({
        filename: item.filename,
        title,
        creator: artist,
        license: licenceShort,
        licenseUrl: licenceUrl,
        source: 'Wikimedia Commons',
        sourceUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(item.commonsTitle)}`,
        originalFile: item.commonsTitle,
        credit,
        dimensions: `${info.thumburl ? item.width : (info.width ?? '?')}px wide`,
        modifications: 'None. Used unmodified apart from display sizing and CSS cropping.',
        usage: item.usage,
        subject: item.subject,
        fetchedAt: new Date().toISOString(),
      })

      process.stdout.write(`ok — ${licenceShort} (${Math.round(bytes.byteLength / 1024)} KB)\n`)
      // Space requests out so a four-item run does not look like a scraper.
      await sleep(1_500)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      process.stdout.write('FAILED\n')
      process.stderr.write(`    ${message}\n`)
      failures.push(item.filename)
    }
  }

  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify(
      {
        note:
          'Attribution for third-party photographs used in Arcade. Every licence and author ' +
          'credit below was read from the Wikimedia Commons API at download time rather than ' +
          'transcribed by hand. All files permit commercial use and are used unmodified apart ' +
          'from display sizing. Regenerate with: pnpm fetch:media',
        acceptedLicenses: [
          'CC BY (any version)',
          'CC BY-SA (any version)',
          'CC0',
          'Public domain',
        ],
        generatedAt: new Date().toISOString(),
        media: records,
      },
      null,
      2,
    )}\n`,
  )

  process.stdout.write(`\nwrote ${MANIFEST_PATH}\n`)

  if (failures.length > 0) {
    process.stderr.write(
      `\n${failures.length} item(s) failed: ${failures.join(', ')}\n` +
        'Photographs are editorial accents; the site renders without them.\n',
    )
    process.exit(1)
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\nmedia fetch failed: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
