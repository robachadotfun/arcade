/**
 * optimize-images.ts
 *
 * Converts generated art, photography and token logos to web-sized WebP.
 *
 * ## Why this exists
 *
 * The image model returns 1–1.8 MB PNGs and the photography is 1–2 MB JPEG. Shipping those
 * as source files means a slow first build, a bloated repository, and a Lighthouse score
 * that reflects none of the care in the rest of the product. WebP at a sensible ceiling
 * width gets the same result at roughly a twentieth of the bytes.
 *
 * Originals are replaced rather than kept alongside: generated art is reproducible from
 * `pnpm generate:art` and photography from `pnpm fetch:media`, so keeping both would be
 * storing something we can regenerate.
 *
 * Token logos are handled differently — they are small, square, and displayed at 16–52px,
 * so they get a tighter ceiling and stay lossless-ish to keep small marks crisp.
 *
 * `public/brand/` is deliberately absent from the targets below and must stay that way. The
 * identity mark there is supplied artwork, shipped byte-for-byte and served unoptimised; a
 * re-encode would make what the site renders no longer the file that was handed over.
 *
 * Usage: pnpm optimize:images
 */

import {readdirSync, statSync, writeFileSync, unlinkSync, existsSync, readFileSync} from 'node:fs'
import {dirname, extname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import sharp, {type Sharp} from 'sharp'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC = resolve(HERE, '../public')

type Target = {
  dir: string
  /** Longest edge, in pixels. */
  maxWidth: number
  quality: number
  label: string
  /** Files to leave alone. */
  skip?: (file: string) => boolean
  /**
   * Remap the artwork's own background to pure white.
   *
   * The illustrations are drawn on a cream ground that is close to, but not identical to, the
   * page's ivory. They are composited with `mix-blend-mode: multiply`, and multiply *darkens*
   * — so a cream ground over ivory paper leaves a visibly darker rectangle, which is exactly
   * the "pasted into a box" look we are trying to avoid. Scaling each channel so the ground
   * becomes pure white makes multiply a no-op there, and the illustration reads as drawn
   * directly on the page.
   */
  whitenGround?: boolean
}

const TARGETS: Target[] = [
  {
    dir: join(PUBLIC, 'generated'),
    // Wide art is used at up to ~1400 CSS px on a 2x display; 1600 is a fair ceiling
    // before diminishing returns.
    maxWidth: 1600,
    quality: 82,
    label: 'generated art',
    whitenGround: true,
  },
  {
    dir: join(PUBLIC, 'media'),
    maxWidth: 1600,
    quality: 78,
    label: 'photography',
  },
  {
    dir: join(PUBLIC, 'tokens'),
    // Logos render at 16–52 px. 256 is generous even for a 2x reveal glyph.
    maxWidth: 256,
    quality: 90,
    label: 'token logos',
  },
]

const SOURCE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function bytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`
  return `${Math.round(n / 1024)} KB`
}

/**
 * Samples the artwork's background colour from its corners.
 *
 * Every illustration is a centred object on an empty ground, so the corners are reliably
 * background. The median of the four is used so a stray shadow reaching one corner cannot
 * skew the result.
 */
async function sampleGround(input: Sharp): Promise<{r: number; g: number; b: number} | null> {
  const meta = await input.metadata()
  const width = meta.width
  const height = meta.height
  if (!width || !height) return null

  const patch = Math.max(8, Math.floor(Math.min(width, height) * 0.02))
  const corners = [
    {left: 0, top: 0},
    {left: width - patch, top: 0},
    {left: 0, top: height - patch},
    {left: width - patch, top: height - patch},
  ]

  const samples: Array<{r: number; g: number; b: number}> = []
  for (const corner of corners) {
    const {data} = await input
      .clone()
      .extract({...corner, width: patch, height: patch})
      .resize(1, 1, {fit: 'cover'})
      .raw()
      .toBuffer({resolveWithObject: true})
    const r = data[0]
    const g = data[1]
    const b = data[2]
    if (r !== undefined && g !== undefined && b !== undefined) samples.push({r, g, b})
  }
  if (samples.length === 0) return null

  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted[mid] ?? 255
  }

  return {
    r: median(samples.map((s) => s.r)),
    g: median(samples.map((s) => s.g)),
    b: median(samples.map((s) => s.b)),
  }
}

async function optimizeDir(target: Target): Promise<{before: number; after: number; count: number}> {
  if (!existsSync(target.dir)) return {before: 0, after: 0, count: 0}

  const files = readdirSync(target.dir).filter((file) => {
    if (!SOURCE_EXTENSIONS.has(extname(file).toLowerCase())) return false
    return !target.skip?.(file)
  })

  let before = 0
  let after = 0
  let count = 0

  for (const file of files) {
    const path = join(target.dir, file)
    const originalSize = statSync(path).size
    const base = file.replace(/\.[^.]+$/, '')
    const outPath = join(target.dir, `${base}.webp`)

    const image = sharp(path)
    const meta = await image.metadata()
    const width = meta.width ?? target.maxWidth

    let pipeline = image.resize({
      width: Math.min(width, target.maxWidth),
      withoutEnlargement: true,
    })

    if (target.whitenGround) {
      const ground = await sampleGround(sharp(path))
      // Only correct an actual light ground. A dark corner would mean the subject reaches the
      // edge, and scaling then would blow out the whole illustration.
      if (ground && ground.r > 200 && ground.g > 200 && ground.b > 200) {
        pipeline = pipeline.linear(
          [255 / ground.r, 255 / ground.g, 255 / ground.b],
          [0, 0, 0],
        )
      }
    }

    const output = await pipeline.webp({quality: target.quality, effort: 5}).toBuffer()

    // Only accept the conversion if it actually saved bytes; a small already-optimised
    // logo can come out larger, and shipping a worse file would be pointless.
    if (extname(file).toLowerCase() === '.webp' && output.byteLength >= originalSize) {
      before += originalSize
      after += originalSize
      continue
    }

    writeFileSync(outPath, output)
    if (outPath !== path) unlinkSync(path)

    before += originalSize
    after += output.byteLength
    count += 1

    process.stdout.write(
      `  ${base.padEnd(24)} ${bytes(originalSize).padStart(8)} -> ${bytes(output.byteLength).padStart(8)}\n`,
    )
  }

  return {before, after, count}
}

/** Rewrites a manifest's recorded filenames after conversion, so provenance stays accurate. */
function retargetManifest(path: string, key: string, fileField: string) {
  if (!existsSync(path)) return
  try {
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const list = json[key]
    if (!Array.isArray(list)) return

    let changed = false
    for (const entry of list as Array<Record<string, unknown>>) {
      const file = entry[fileField]
      if (typeof file !== 'string') continue
      const next = file.replace(/\.(png|jpe?g)$/i, '.webp')
      if (next !== file) {
        entry[fileField] = next
        changed = true
      }
    }

    if (changed) {
      writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`)
      process.stdout.write(`  manifest updated: ${path.replace(PUBLIC, 'public')}\n`)
    }
  } catch {
    process.stderr.write(`  could not update manifest ${path}\n`)
  }
}

async function main() {
  process.stdout.write('Arcade image optimisation\n\n')

  let totalBefore = 0
  let totalAfter = 0

  for (const target of TARGETS) {
    process.stdout.write(`${target.label} (max ${target.maxWidth}px, q${target.quality})\n`)
    const result = await optimizeDir(target)
    if (result.count === 0) process.stdout.write('  nothing to do\n')
    totalBefore += result.before
    totalAfter += result.after
    process.stdout.write('\n')
  }

  retargetManifest(join(PUBLIC, 'generated', 'manifest.json'), 'assets', 'file')
  retargetManifest(join(PUBLIC, 'media', 'media-attribution.json'), 'media', 'filename')
  retargetManifest(join(PUBLIC, 'tokens', 'logo-manifest.json'), 'logos', 'file')

  const saved = totalBefore - totalAfter
  const pct = totalBefore > 0 ? Math.round((saved / totalBefore) * 100) : 0
  process.stdout.write(
    `\ntotal ${bytes(totalBefore)} -> ${bytes(totalAfter)}  (saved ${bytes(saved)}, ${pct}%)\n`,
  )
}

main().catch((err: unknown) => {
  process.stderr.write(`\noptimisation failed: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
