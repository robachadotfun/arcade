/**
 * Signer resolution for the operator CLI.
 *
 * ## The point of this file
 *
 * A raw private key in an environment variable is readable by every process that inherits the
 * environment, lands in shell history if it is ever exported by hand, and survives in
 * `.env.local` as plaintext on disk. For a testnet key that is an acceptable trade. For a key
 * holding real USDC it is not.
 *
 * So the preferred path is an encrypted keystore: the key is encrypted at rest under a
 * password, decrypted into process memory for the lifetime of one command, and never written
 * anywhere. The operator creates it themselves with
 *
 *     cast wallet import arcade-operator --interactive
 *
 * which reads the key from the terminal with echo disabled — so it does not appear in scroll
 * back, in shell history, or in any file this repository can see.
 *
 * Better still, and supported by `forge script` directly, is a hardware wallet:
 * `--ledger` or `--trezor`. The key never leaves the device and no software here ever holds
 * it. That is the right answer for a mainnet deployment.
 *
 * ## Resolution order
 *
 *   1. ARCADE_OPERATOR_KEYSTORE   — path to a Web3 Secret Storage v3 JSON file
 *   2. ARCADE_OPERATOR_ACCOUNT    — a name under ~/.foundry/keystores
 *   3. ARCADE_OPERATOR_PRIVATE_KEY — raw hex. Testnet and throwaway keys only.
 *
 * The password is read from the terminal with echo disabled. `ARCADE_OPERATOR_PASSWORD` is
 * honoured for unattended runs of the reveal daemon, which has to survive a restart without a
 * human present; that reintroduces a secret in the environment, so scope it to a process
 * manager's secret store rather than a shell profile.
 */

import {createDecipheriv, pbkdf2Sync, scryptSync} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join, resolve} from 'node:path'
import {createInterface} from 'node:readline'
import {keccak256, type Hex} from 'viem'
import {privateKeyToAccount, type PrivateKeyAccount} from 'viem/accounts'

export class SignerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignerError'
  }
}

type KeystoreV3 = {
  version: number
  address?: string
  crypto: {
    cipher: string
    ciphertext: string
    cipherparams: {iv: string}
    kdf: string
    kdfparams: Record<string, unknown>
    mac: string
  }
}

/** Reads a line from the terminal with echo disabled, so it never appears on screen. */
async function promptHidden(prompt: string): Promise<string> {
  // Read from the tty rather than stdin: the daemon may be started with stdin redirected,
  // and a password prompt that silently consumed piped data would be worse than failing.
  const input = existsSync('/dev/tty') ? readFileSync('/dev/tty') && process.stdin : process.stdin
  if (!input.isTTY) {
    throw new SignerError(
      'A password is required but this process has no terminal attached.\n' +
        'Run the command interactively, or set ARCADE_OPERATOR_PASSWORD from a secret store.',
    )
  }

  return new Promise((resolvePrompt, reject) => {
    const rl = createInterface({input, output: process.stderr, terminal: true})
    // Suppress echo by swallowing what readline would otherwise write back.
    const muted = rl as unknown as {_writeToOutput: (s: string) => void}
    const original = muted._writeToOutput.bind(muted)
    muted._writeToOutput = (chunk: string) => {
      if (chunk.includes(prompt)) original(chunk)
    }

    rl.question(prompt, (answer) => {
      muted._writeToOutput = original
      process.stderr.write('\n')
      rl.close()
      if (!answer) reject(new SignerError('No password entered.'))
      else resolvePrompt(answer)
    })
  })
}

function num(params: Record<string, unknown>, key: string, fallback?: number): number {
  const value = params[key]
  if (typeof value === 'number') return value
  if (fallback !== undefined) return fallback
  throw new SignerError(`Keystore kdfparams.${key} is missing or not a number.`)
}

function str(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string') {
    throw new SignerError(`Keystore kdfparams.${key} is missing or not a string.`)
  }
  return value
}

/**
 * Decrypts a Web3 Secret Storage v3 keystore — the format `cast wallet import` writes.
 *
 * The MAC is verified before the ciphertext is touched. A wrong password produces a MAC
 * mismatch, which is reported as a wrong password rather than as garbage key material: a
 * silently mis-decrypted key would derive a valid-looking address for an account that holds
 * nothing, and the failure would not surface until a transaction was already being signed.
 */
function decryptKeystore(keystore: KeystoreV3, password: string): Hex {
  if (keystore.version !== 3) {
    throw new SignerError(`Unsupported keystore version ${keystore.version}; expected 3.`)
  }

  const {crypto: c} = keystore
  const kdfparams = c.kdfparams
  const salt = Buffer.from(str(kdfparams, 'salt'), 'hex')
  const dklen = num(kdfparams, 'dklen', 32)
  const secret = Buffer.from(password, 'utf8')

  let derived: Buffer
  if (c.kdf === 'scrypt') {
    const n = num(kdfparams, 'n')
    const r = num(kdfparams, 'r')
    const p = num(kdfparams, 'p')
    derived = scryptSync(secret, salt, dklen, {
      N: n,
      r,
      p,
      // scrypt with the standard n=262144 needs far more than Node's 32 MB default.
      maxmem: 2048 * 1024 * 1024,
    })
  } else if (c.kdf === 'pbkdf2') {
    const iterations = num(kdfparams, 'c')
    const prf = kdfparams['prf']
    if (prf !== undefined && prf !== 'hmac-sha256') {
      throw new SignerError(`Unsupported pbkdf2 prf "${String(prf)}".`)
    }
    derived = pbkdf2Sync(secret, salt, iterations, dklen, 'sha256')
  } else {
    throw new SignerError(`Unsupported keystore kdf "${c.kdf}".`)
  }

  const ciphertext = Buffer.from(c.ciphertext, 'hex')
  const mac = keccak256(
    new Uint8Array(Buffer.concat([derived.subarray(16, 32), ciphertext])),
  ).slice(2)

  if (mac.toLowerCase() !== c.mac.toLowerCase().replace(/^0x/, '')) {
    throw new SignerError('Wrong password for this keystore (MAC mismatch).')
  }

  if (c.cipher !== 'aes-128-ctr') {
    throw new SignerError(`Unsupported keystore cipher "${c.cipher}".`)
  }

  const decipher = createDecipheriv(
    'aes-128-ctr',
    derived.subarray(0, 16),
    Buffer.from(c.cipherparams.iv, 'hex'),
  )
  const key = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return `0x${key.toString('hex')}` as Hex
}

export type ResolvedSigner = {
  account: PrivateKeyAccount
  /** How the key was obtained, for the banner. Never includes the key itself. */
  source: string
}

/**
 * Resolves a signer, or returns null when none is configured.
 *
 * Read-only commands pass through with null so an operator can inspect a deployment without
 * putting a key anywhere near the process.
 */
export async function resolveSigner(): Promise<ResolvedSigner | null> {
  const keystorePath = process.env.ARCADE_OPERATOR_KEYSTORE
  const accountName = process.env.ARCADE_OPERATOR_ACCOUNT
  const rawKey = process.env.ARCADE_OPERATOR_PRIVATE_KEY

  const path = keystorePath
    ? resolve(keystorePath)
    : accountName
      ? join(homedir(), '.foundry', 'keystores', accountName)
      : null

  if (path) {
    if (!existsSync(path)) {
      throw new SignerError(
        `No keystore at ${path}.\n` +
          'Create one with:  cast wallet import <name> --interactive',
      )
    }

    let keystore: KeystoreV3
    try {
      keystore = JSON.parse(readFileSync(path, 'utf8')) as KeystoreV3
    } catch {
      throw new SignerError(`${path} is not valid JSON.`)
    }

    const password =
      process.env.ARCADE_OPERATOR_PASSWORD ??
      (await promptHidden(`Password for ${accountName ?? path}: `))

    const key = decryptKeystore(keystore, password)
    const account = privateKeyToAccount(key)

    // The keystore records the address it was created for. A mismatch means the file was
    // tampered with or swapped, which is worth failing on rather than quietly signing.
    if (keystore.address) {
      const expected = `0x${keystore.address.replace(/^0x/, '')}`.toLowerCase()
      if (account.address.toLowerCase() !== expected) {
        throw new SignerError(
          `Keystore says its address is ${expected} but the decrypted key derives ${account.address.toLowerCase()}.`,
        )
      }
    }

    return {account, source: `keystore ${accountName ?? path}`}
  }

  if (rawKey) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(rawKey)) {
      // Deliberately does not echo the value.
      throw new SignerError(
        'ARCADE_OPERATOR_PRIVATE_KEY is set but is not a 0x-prefixed 32-byte hex key.',
      )
    }
    return {
      account: privateKeyToAccount(rawKey as Hex),
      source: 'ARCADE_OPERATOR_PRIVATE_KEY (plaintext env — testnet keys only)',
    }
  }

  return null
}
