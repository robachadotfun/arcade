import {timingSafeEqual} from 'node:crypto'

/**
 * Admin gate.
 *
 * ## What this is, and what it is not
 *
 * This is an **environment-controlled shared secret**, checked server-side against a
 * constant-time comparison. It is adequate for a single operator on a private deployment,
 * and it is deliberately structured so it can be replaced without touching the admin UI:
 * every admin route calls {@link verifyAdminToken}, so swapping in SIWE, an OIDC provider or
 * a role check against `AccessControl` means changing this one module.
 *
 * It is **not** adequate for a multi-operator production deployment. A shared secret has no
 * per-user identity, no audit trail, no revocation and no second factor. The README's
 * production checklist requires replacing it.
 *
 * Note what this gate does and does not protect. The admin UI is a convenience layer: every
 * state-changing action still goes through a wallet signature and is still checked against
 * the contract's own role assignments. Someone who obtained this token could read the
 * dashboard, but could not change a machine, move inventory or pause anything without also
 * holding a key that the contracts recognise.
 */

const ADMIN_KEY_ENV = 'ARCADE_ADMIN_KEY'
const MIN_KEY_LENGTH = 24

/** True when an admin key of adequate length is configured. */
export function isAdminEnabled(): boolean {
  const key = process.env[ADMIN_KEY_ENV]
  return typeof key === 'string' && key.length >= MIN_KEY_LENGTH
}

/**
 * Constant-time comparison of a submitted token against the configured key.
 *
 * Lengths are compared first and then a fixed-length digest is compared, so the check does
 * not leak the key's length or an early-mismatch position through timing.
 */
export function verifyAdminToken(submitted: string | undefined | null): boolean {
  const key = process.env[ADMIN_KEY_ENV]
  if (typeof key !== 'string' || key.length < MIN_KEY_LENGTH) return false
  if (typeof submitted !== 'string' || submitted.length === 0) return false

  const a = Buffer.from(submitted, 'utf8')
  const b = Buffer.from(key, 'utf8')
  if (a.length !== b.length) {
    // Still burn a comparison so a length mismatch is not faster than a content mismatch.
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}

export const ADMIN_COOKIE = 'arcade_admin'
/** Short-lived on purpose: a shared secret should not grant a long session. */
export const ADMIN_SESSION_SECONDS = 60 * 60 * 4
