/**
 * Deliberately empty, and deliberately CommonJS.
 *
 * Stands in for the `@x402/*` specifiers that `@wagmi/connectors` reaches through Coinbase's
 * `baseAccount` connector and which do not resolve. See `next.config.ts` for why those
 * imports exist at all and why replacing them is safe: nothing in Arcade can call them.
 *
 * CommonJS because the importers use *named* imports (`toClientEvmSigner` and friends).
 * Turbopack treats a missing named export as a build error where webpack only warns, and an
 * ESM stub cannot declare names it does not know in advance. A CJS module is interoperated
 * as a single default object, so any named import resolves — to undefined, which is correct
 * here: calling one is already impossible.
 */
module.exports = {}
