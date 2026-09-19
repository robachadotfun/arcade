/**
 * fetch-token-logos.ts
 *
 * Downloads the real, published logo for each verified reward token into `public/tokens/`
 * and records where each one came from in `public/tokens/logo-manifest.json`.
 *
 * ## Rules
 *
 * 1. **Only real logos.** Nothing here draws, generates or approximates a project's mark. A
 *    plausible-looking fake logo is worse than no logo, because it invites someone to trust
 *    the wrong thing — and on Arc, where several tokens share a ticker, a wrong mark is a
 *    direct route to confusing two different assets.
 * 2. **A token with no published logo keeps its typographic monogram.** That fallback is
 *    already implemented in `TokenGlyph`, and it is the honest answer.
 * 3. **Keyed by contract address, never by ticker.** Research found six ticker collisions
 *    among Arc candidates, including two tokens squatting `USDC`.
 * 4. **Only verified tokens.** The source list is the verification report, so a logo cannot
 *    be fetched for something that never passed the onchain checks.
 *
 * Usage: pnpm fetch:logos
 */

import {mkdirSync, writeFileSync, readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const VERIFIED_PATH = resolve(HERE, 'data/arc-token-verified.json')
const OUT_DIR = resolve(HERE, '../public/tokens')
const MANIFEST_PATH = resolve(OUT_DIR, 'logo-manifest.json')

/**
 * Logo sources, tried in order.
 *
 * `tollyLabs` serves Arc token images keyed by contract address and covers most of the
 * ecosystem. CoinGecko covers the bridged majors it does not.
 */
const ARC_TOKEN_IMAGE = (address: string) =>
  `https://api.tollylabs.com/token-image/${address.toLowerCase()}.png`

/**
 * Canonical fallbacks for assets with no Arc-native image entry.
 *
 * Keyed by contract address and annotated with what the asset is, so a future editor can
 * tell at a glance that these point at the right project rather than a same-ticker
 * impostor.
 */
const CANONICAL_FALLBACKS: Record<string, {url: string; source: string; note: string}> = {
  '0x8c4252c87081c88c6ad57d6dd97e1cafebf842b7': {
    url: 'https://coin-images.coingecko.com/coins/images/34057/large/LOGOMARK.png',
    source: 'CoinGecko — virtual-protocol',
    note: 'Virtuals Protocol (VIRTUAL). Verified against the CoinGecko entry for that project.',
  },
  '0x128cc466b61f542da60c70e3aa11c10e19b84edb': {
    url: 'https://coin-images.coingecko.com/coins/images/2518/large/weth.png',
    source: 'CoinGecko — weth',
    note: 'Wrapped Ether (WETH). The canonical WETH mark.',
  },
}

/**
 * Tokens knowingly left without a logo.
 *
 * Recorded explicitly so "no logo" reads as a checked finding rather than an oversight.
 */
const KNOWN_NO_LOGO: Record<string, string> = {
  '0x171a4217b86a807a64eb94757db6849fb4bdbaa0':
    'Circle Wrapped Bitcoin (cirBTC) publishes no logo through any source checked, including the Arc token image service and CoinGecko. It keeps its typographic monogram rather than being given an invented mark.',
}

type VerifiedToken = {
  address: string
  eligible: boolean
  onchain: {symbol: string | null; name: string | null; decimals: number | null}
}

type LogoRecord = {
  address: string
  symbol: string | null
  file: string | null
  source: string
  sourceUrl: string | null
  contentType: string | null
  bytes: number | null
  note?: string
  fetchedAt: string
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Extension for a served content type. Only real raster/vector image types are accepted. */
function extensionFor(contentType: string | null): string | null {
  if (!contentType) return null
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  if (contentType.includes('svg')) return 'svg'
  return null
}

async function tryDownload(
  url: string,
): Promise<{bytes: Buffer; contentType: string} | {error: string}> {
  try {
    const res = await fetch(url, {
      headers: {'user-agent': 'ArcadeBuild/1.0 (token logo fetch)'},
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) return {error: `HTTP ${res.status}`}

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      return {error: `not an image (${contentType || 'no content-type'})`}
    }

    const bytes = Buffer.from(await res.arrayBuffer())
    // A handful of bytes is an error page, not a logo.
    if (bytes.byteLength < 256) return {error: `suspiciously small (${bytes.byteLength} bytes)`}

    return {bytes, contentType}
  } catch (err) {
    return {error: err instanceof Error ? err.message : String(err)}
  }
}

async function main() {
  const report = JSON.parse(readFileSync(VERIFIED_PATH, 'utf8')) as {tokens: VerifiedToken[]}
  const eligible = report.tokens.filter((t) => t.eligible)

  mkdirSync(OUT_DIR, {recursive: true})
  process.stdout.write(`Arcade token logos\nverified tokens: ${eligible.length}\n\n`)

  const records: LogoRecord[] = []

  for (const token of eligible) {
    const address = token.address.toLowerCase()
    const symbol = token.onchain.symbol
    process.stdout.write(`. ${(symbol ?? '??').padEnd(11)} `)

    // Deliberate omission takes precedence over any lookup.
    const known = KNOWN_NO_LOGO[address]
    if (known) {
      process.stdout.write('monogram (no published logo)\n')
      records.push({
        address,
        symbol,
        file: null,
        source: 'none',
        sourceUrl: null,
        contentType: null,
        bytes: null,
        note: known,
        fetchedAt: new Date().toISOString(),
      })
      continue
    }

    const attempts: Array<{url: string; source: string; note?: string}> = [
      {url: ARC_TOKEN_IMAGE(address), source: 'Arc token image service (api.tollylabs.com)'},
    ]
    const fallback = CANONICAL_FALLBACKS[address]
    if (fallback) attempts.push({url: fallback.url, source: fallback.source, note: fallback.note})

    let saved = false
    const errors: string[] = []

    for (const attempt of attempts) {
      const result = await tryDownload(attempt.url)
      if ('error' in result) {
        errors.push(`${attempt.source}: ${result.error}`)
        continue
      }

      const ext = extensionFor(result.contentType)
      if (!ext) {
        errors.push(`${attempt.source}: unsupported type ${result.contentType}`)
        continue
      }

      const file = `${address}.${ext}`
      writeFileSync(resolve(OUT_DIR, file), result.bytes)
      records.push({
        address,
        symbol,
        file,
        source: attempt.source,
        sourceUrl: attempt.url,
        contentType: result.contentType,
        bytes: result.bytes.byteLength,
        ...(attempt.note ? {note: attempt.note} : {}),
        fetchedAt: new Date().toISOString(),
      })
      process.stdout.write(`${ext} ${Math.round(result.bytes.byteLength / 1024)} KB\n`)
      saved = true
      break
    }

    if (!saved) {
      process.stdout.write('monogram (no logo found)\n')
      records.push({
        address,
        symbol,
        file: null,
        source: 'none',
        sourceUrl: null,
        contentType: null,
        bytes: null,
        note: `No logo retrieved. Tried: ${errors.join('; ')}. Falls back to a typographic monogram rather than an invented mark.`,
        fetchedAt: new Date().toISOString(),
      })
    }

    await sleep(300)
  }

  const withLogo = records.filter((r) => r.file !== null)

  writeFileSync(
    MANIFEST_PATH,
    `${JSON.stringify(
      {
        note:
          'Real, published logos for verified Arcade reward tokens, keyed by contract address. ' +
          'No logo here is drawn, generated or approximated — a token with no published mark ' +
          'keeps a typographic monogram instead. Regenerate with: pnpm fetch:logos',
        generatedAt: new Date().toISOString(),
        summary: {
          verifiedTokens: eligible.length,
          withLogo: withLogo.length,
          withMonogram: records.length - withLogo.length,
        },
        logos: records.sort((a, b) => (a.symbol ?? '').localeCompare(b.symbol ?? '')),
      },
      null,
      2,
    )}\n`,
  )

  process.stdout.write(
    `\n${withLogo.length}/${eligible.length} logos saved; ${records.length - withLogo.length} keep a monogram.\nwrote ${MANIFEST_PATH}\n`,
  )
}

main().catch((err: unknown) => {
  process.stderr.write(`\nlogo fetch failed: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
