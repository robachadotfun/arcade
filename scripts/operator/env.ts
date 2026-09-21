/**
 * Loads `.env.local` into `process.env` for the command-line scripts.
 *
 * Next.js reads `.env.local` for the app, but a script run through `tsx` does not, so without
 * this the operator CLI ignores the file the README tells you to fill in.
 *
 * ## Why this is its own module, imported first
 *
 * `src/config/machines.ts` reads `NEXT_PUBLIC_ARCADE_MACHINE_IDS` at module scope, and ES
 * imports are hoisted and evaluated in order before any statement in the importing file runs.
 * Loading the env file from the body of `operator.ts` would therefore happen *after* machine
 * ids had already resolved to null. Importing this module first puts the load ahead of them.
 *
 * Variables already set in the shell win over the file — `process.loadEnvFile` does not
 * overwrite — so a one-off `NEXT_PUBLIC_ARCADE_MODE=testnet pnpm operator status` still works.
 */

import {existsSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = resolve(ROOT, '.env.local')

if (existsSync(FILE)) {
  process.loadEnvFile(FILE)
}
