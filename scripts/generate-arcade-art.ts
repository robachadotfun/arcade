/**
 * generate-arcade-art.ts
 *
 * Generates Arcade's editorial art pack with OpenAI image generation.
 *
 * ## Key handling — the important part
 *
 * The API key is read from `OPENAI_API_KEY`, a **server-only** environment variable, and is
 * used only inside this Node script. It is never:
 *
 *   - exposed through a `NEXT_PUBLIC_*` variable
 *   - imported by any file under `src/`
 *   - bundled into client JavaScript
 *   - written to disk, logged, or included in the generated manifest
 *
 * The site never calls OpenAI at runtime. This is a one-off build-time step whose output is
 * a set of PNGs in `public/generated/`.
 *
 * ## The site still works without it
 *
 * Every structural visual — the orbit machine, the hero geometry, the fairness diagram — is
 * hand-drawn SVG and CSS. Generated art is layered on top as atmosphere. If
 * `OPENAI_API_KEY` is absent the script exits cleanly and the site renders without it.
 *
 * Usage:
 *   export OPENAI_API_KEY=sk-...        # never commit this
 *   pnpm generate:art                   # everything missing
 *   pnpm generate:art hero-orbit        # one asset
 *   pnpm generate:art --force           # regenerate everything
 */

import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(HERE, '../public/generated')
const MANIFEST_PATH = resolve(OUT_DIR, 'manifest.json')

const ENDPOINT = 'https://api.openai.com/v1/images/generations'
const MODEL = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-sunburst'

/** How many generations to run at once. The API tolerates a handful comfortably. */
const CONCURRENCY = Number.parseInt(process.env.ARCADE_ART_CONCURRENCY ?? '3', 10)

/**
 * Shared art direction.
 *
 * Deliberately prescriptive about what to avoid: the default register for "blockchain
 * arcade" is neon cyberpunk, which is the opposite of Arc's visual language.
 */
const ART_DIRECTION = [
  'Isometric technical illustration, true 30-degree axonometric projection.',
  'Editorial architectural draughtsmanship: flat vector shapes, fine hairline deep-navy outlines,',
  'soft paper-grain fills, long soft isometric shadows on a warm ivory ground.',
  'Palette strictly limited to warm ivory, bone white, powder blue, pale sky blue, warm peach,',
  'soft sand, deep navy linework, with one accent of strong arc blue.',
  'Precise, calm, expensive, generous empty space around the subject.',
  'ABSOLUTELY NO icons, NO pictograms, NO symbols, NO emblems, NO charts, NO arrows,',
  'NO text, NO letters, NO numbers, NO logos, NO faces, NO characters, NO people.',
  'All surfaces are blank and featureless.',
  'Not cartoon, not cute, no gloss, no neon, no cyberpunk, no photorealism, no 3D render sheen.',
].join(' ')

type Asset = {
  name: string
  /** Subject-specific direction, appended to the shared art direction. */
  subject: string
  size: '1024x1024' | '1536x1024' | '1024x1536'
  /** Where the asset is used, recorded in the manifest. */
  usage: string
}

const ASSETS: Asset[] = [
  // ─────────────────────────────────────────────────────────────── hero / atmosphere
  {
    name: 'hero-orbit',
    subject:
      'Subject: a wide flat circular orbital track lying horizontally in the isometric plane, raised on slim posts above a low round plinth. Six plain blank discs of different pale tints ride on the track, evenly spaced and completely featureless. One clear glass sphere rests in a shallow circular recess at the exact centre of the plinth.',
    size: '1536x1024',
    usage: 'Homepage hero — the Arcade machine as an isometric object.',
  },

  // ───────────────────────────────────────────────────────────────────── machines
  {
    name: 'genesis-machine',
    subject:
      'Subject: a broad isometric machine — one wide flat circular track on a low cylindrical plinth, carrying seven small blank discs in varied pale tints, with a clear glass sphere at the centre. Generous, open, balanced.',
    size: '1024x1024',
    usage: 'Genesis machine illustration.',
  },
  {
    name: 'velocity-machine',
    subject:
      'Subject: a fast isometric machine — a narrow circular track on a slim plinth where three blank discs are sharp and the rest of the ring is drawn as a smooth tapering motion arc in arc blue, suggesting rapid rotation. Taut and quick.',
    size: '1024x1024',
    usage: 'Velocity machine illustration.',
  },
  {
    name: 'bluechip-machine',
    subject:
      'Subject: a heavy isometric machine — a thick solid stepped plinth of bone white carrying only three large blank discs on a short sturdy ring, with one big clear glass sphere seated deep in a machined central recess. Weighty and restrained.',
    size: '1024x1024',
    usage: 'Blue Chip machine illustration.',
  },
  {
    name: 'discovery-machine',
    subject:
      'Subject: an exploratory isometric machine — three concentric circular tracks of different radii at slightly different heights on a low plinth, each carrying two or three small blank discs of varied pale tints, arranged irregularly.',
    size: '1024x1024',
    usage: 'Discovery machine illustration.',
  },
  {
    name: 'machine-zero',
    subject:
      'Subject: an unfinished isometric machine — a partially assembled circular track with one quadrant missing, resting on a plinth beside two loose blank discs and a set of faint dashed isometric construction lines showing where the remaining parts would go. A prototype on a drafting plane.',
    size: '1024x1024',
    usage: 'Machine Zero (experimental) illustration.',
  },

  // ───────────────────────────────────────────────────────────────────── fairness
  {
    name: 'fairness-commitment',
    subject:
      'Subject: an isometric cabinet of sealed capsules — a low bone-white rack holding a neat row of closed cylindrical capsules in identical slots, every capsule shut and identical, one slot at the front standing empty and ready. Order and sequence, nothing opened yet.',
    size: '1536x1024',
    usage: 'Fairness — the commitment stage.',
  },
  {
    name: 'fairness-reveal',
    subject:
      'Subject: an isometric opened capsule — one cylindrical capsule lying open on the ivory plane with its two halves separated, a single clear glass sphere having rolled a short distance away and come to rest, a faint dotted isometric path tracing where it travelled.',
    size: '1536x1024',
    usage: 'Fairness — the reveal stage.',
  },
  {
    name: 'reward-chamber',
    subject:
      'Subject: an isometric cutaway of a circular chamber — a round bone-white basin seen in section, concentric stepped rings descending inward, one clear glass sphere settled precisely in the lowest centre ring with a soft arc-blue pool of light around it.',
    size: '1024x1024',
    usage: 'Reward reveal illustration.',
  },
  {
    name: 'verification',
    subject:
      'Subject: an isometric verification bench — a flat bone-white ledger plane ruled with faint isometric guide lines, a large round glass lens on a slim stand hovering above one part of it, and three small blank discs laid out in a row beneath the lens.',
    size: '1536x1024',
    usage: 'Fairness — independent verification.',
  },

  // ───────────────────────────────────────────────────────────────────── rewards
  {
    name: 'rewards-array',
    subject:
      'Subject: an isometric display tray — a shallow rectangular bone-white tray on the ivory plane holding thirteen small blank discs in varied pale tints, arranged in a precise grid, each seated in its own shallow circular recess, each casting a small isometric shadow.',
    size: '1536x1024',
    usage: 'Rewards page — the verified reward set.',
  },
  {
    name: 'vault',
    subject:
      'Subject: an isometric prize vault — a low open-topped bone-white strongbox on the ivory plane, its interior divided into four compartments, three holding small stacks of blank pale discs and one standing empty. Solid walls, a thick base, calm.',
    size: '1024x1024',
    usage: 'Prize vault and inventory illustration.',
  },
  {
    name: 'treasury',
    subject:
      'Subject: an isometric balance — a slim bone-white beam balance on a low plinth, one shallow pan holding a neat stack of blank pale discs and the other holding a single clear glass sphere, the beam very slightly tilted. Measurement, not commerce.',
    size: '1024x1024',
    usage: 'Economic safety / treasury illustration.',
  },

  // ───────────────────────────────────────────────────────────── rarity portraits
  {
    name: 'rarity-common',
    subject:
      'Subject: a single low isometric pedestal of plain bone white carrying one small blank pale-sand disc. Plain, modest, one step, nothing else on the plane.',
    size: '1024x1024',
    usage: 'Common rarity band illustration.',
  },
  {
    name: 'rarity-rare',
    subject:
      'Subject: a two-step isometric pedestal of bone white carrying one blank powder-blue disc, with a thin hairline ring engraved around its base. Slightly more considered than plain.',
    size: '1024x1024',
    usage: 'Rare rarity band illustration.',
  },
  {
    name: 'rarity-ultra',
    subject:
      'Subject: a three-step isometric pedestal of bone white carrying one blank warm-peach disc under a slim open circular arch, with two hairline rings engraved around its base.',
    size: '1024x1024',
    usage: 'Ultra rarity band illustration.',
  },
  {
    name: 'rarity-jackpot',
    subject:
      'Subject: a tall stepped isometric pedestal of bone white carrying one clear glass sphere beneath a slim open dome of thin arc-blue ribs, with three hairline rings engraved around its base and a faint pool of arc-blue light beneath.',
    size: '1024x1024',
    usage: 'Jackpot rarity band illustration.',
  },

  // ─────────────────────────────────────────────────────────── flow / structure
  {
    name: 'settlement',
    subject:
      'Subject: an isometric four-station rail — a long straight bone-white channel running diagonally across the ivory plane with four identical low stations spaced evenly along it, a single blank pale disc sitting at the first station and a clear glass sphere resting at the last. Sequence and finality.',
    size: '1536x1024',
    usage: 'How a spin works — the four stages.',
  },
  {
    name: 'network-arc',
    subject:
      'Subject: an isometric network plane — a faint pale-blue isometric grid on ivory with nine small blank nodes of varied heights standing on it, connected by thin straight navy lines, three of the nodes slightly taller than the rest.',
    size: '1536x1024',
    usage: 'Arc network / ecosystem illustration.',
  },

  // ───────────────────────────────────────────────────────── textures / empties
  {
    name: 'empty-tape',
    subject:
      'Subject: an isometric empty rail — a long straight bone-white channel running across the ivory plane, completely empty and unused, with faint evenly spaced tick marks along its edge and one empty circular recess at the near end. Waiting, not broken.',
    size: '1536x1024',
    usage: 'Activity zero state.',
  },
  {
    name: 'empty-wallet',
    subject:
      'Subject: an isometric empty tray — a shallow round bone-white dish on the ivory plane with four empty circular recesses inside it, pristine and unused, casting a soft long isometric shadow.',
    size: '1024x1024',
    usage: 'My Arcade zero state.',
  },
]

type ManifestEntry = {
  name: string
  file: string
  size: string
  usage: string
  model: string
  prompt: string
  generatedAt: string
}

type OpenAIImageResponse = {
  data?: Array<{b64_json?: string; url?: string}>
  error?: {message?: string; type?: string; code?: string}
}

function promptFor(asset: Asset): string {
  return `${ART_DIRECTION} ${asset.subject}`
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function generate(asset: Asset, apiKey: string, attempts = 3): Promise<Buffer> {
  let lastError = ''

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${apiKey}`},
      body: JSON.stringify({
        model: MODEL,
        prompt: promptFor(asset),
        size: asset.size,
        n: 1,
      }),
      signal: AbortSignal.timeout(300_000),
    })

    const text = await response.text()
    let payload: OpenAIImageResponse
    try {
      payload = JSON.parse(text) as OpenAIImageResponse
    } catch {
      lastError = `HTTP ${response.status}, non-JSON body: ${text.slice(0, 200)}`
      await sleep(3_000 * attempt)
      continue
    }

    if (response.ok && !payload.error) {
      const first = payload.data?.[0]
      if (first?.b64_json) return Buffer.from(first.b64_json, 'base64')
      if (first?.url) {
        const image = await fetch(first.url, {signal: AbortSignal.timeout(120_000)})
        if (image.ok) return Buffer.from(await image.arrayBuffer())
      }
      lastError = 'response contained no image data'
    } else {
      // Surface the API's own message: parameter names and model availability change, and a
      // generic "request failed" would hide the actual fix.
      lastError = payload.error?.message ?? `HTTP ${response.status}: ${text.slice(0, 200)}`
      // Rate limits and server errors are worth waiting out; a bad request is not.
      if (response.status !== 429 && response.status < 500) break
    }

    if (attempt < attempts) await sleep(5_000 * attempt)
  }

  throw new Error(`${asset.name}: ${lastError}`)
}

function readManifest(): ManifestEntry[] {
  if (!existsSync(MANIFEST_PATH)) return []
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {assets?: ManifestEntry[]}
    return parsed.assets ?? []
  } catch {
    return []
  }
}

function writeManifest(entries: Map<string, ManifestEntry>) {
  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify(
      {
        note:
          'Generated by scripts/generate-arcade-art.ts. Prompts are recorded so the art is ' +
          'reproducible; the API key is never stored here or anywhere else in the repository. ' +
          'The site renders without these files — every structural visual is hand-drawn SVG.',
        generatedAt: new Date().toISOString(),
        assets: [...entries.values()].sort((a, b) => a.name.localeCompare(b.name)),
      },
      null,
      2,
    )}\n`,
  )
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    // Not an error: the site is fully functional without generated art.
    process.stdout.write(
      [
        'OPENAI_API_KEY is not set, so no art was generated.',
        '',
        'This is not a failure. Every structural visual is hand-drawn SVG and CSS: the orbit',
        'machine, the hero geometry and the fairness diagram all render without these files.',
        '',
        'To generate:  export OPENAI_API_KEY=sk-...  &&  pnpm generate:art',
        '',
      ].join('\n'),
    )
    return
  }

  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const requested = args.filter((a) => !a.startsWith('--'))

  mkdirSync(OUT_DIR, {recursive: true})
  const entries = new Map(readManifest().map((entry) => [entry.name, entry]))

  let targets = requested.length
    ? ASSETS.filter((asset) => requested.includes(asset.name))
    : ASSETS

  if (!force) {
    // Skip anything already on disk, so a re-run only fills gaps.
    targets = targets.filter((asset) => !existsSync(resolve(OUT_DIR, `${asset.name}.png`)))
  }

  if (targets.length === 0) {
    process.stdout.write('Nothing to generate — every asset already exists. Use --force to redo.\n')
    return
  }

  process.stdout.write(
    `Arcade art generation\nmodel: ${MODEL}\nassets: ${targets.length}\nconcurrency: ${CONCURRENCY}\n\n`,
  )

  const failures: string[] = []
  let index = 0
  let done = 0

  async function worker() {
    for (;;) {
      const asset = targets[index++]
      if (!asset) return
      try {
        const image = await generate(asset, apiKey!)
        writeFileSync(resolve(OUT_DIR, `${asset.name}.png`), image)
        entries.set(asset.name, {
          name: asset.name,
          file: `${asset.name}.png`,
          size: asset.size,
          usage: asset.usage,
          model: MODEL,
          prompt: promptFor(asset),
          generatedAt: new Date().toISOString(),
        })
        done += 1
        process.stdout.write(
          `[${done}/${targets.length}] ${asset.name} — ${Math.round(image.byteLength / 1024)} KB\n`,
        )
        // Persist as we go, so an interrupted run keeps what it produced.
        writeManifest(entries)
      } catch (err) {
        done += 1
        const message = err instanceof Error ? err.message : String(err)
        process.stdout.write(`[${done}/${targets.length}] ${asset.name} — FAILED\n`)
        process.stderr.write(`    ${message}\n`)
        failures.push(asset.name)
      }
    }
  }

  await Promise.all(Array.from({length: Math.max(1, CONCURRENCY)}, worker))
  writeManifest(entries)

  process.stdout.write(`\nwrote ${MANIFEST_PATH}\n`)

  if (failures.length > 0) {
    process.stderr.write(
      `\n${failures.length} asset(s) failed: ${failures.join(', ')}\n` +
        'The site still renders — these are atmosphere, not structure. Re-run to retry only ' +
        'the missing ones.\n',
    )
    process.exit(1)
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `\nart generation failed: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
})
