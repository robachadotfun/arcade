/**
 * Deliberately empty.
 *
 * Stands in for `@x402/evm`, which `@wagmi/connectors` reaches through Coinbase's
 * `baseAccount` connector and which does not resolve. See `next.config.ts` for why that
 * import exists at all and why replacing it is safe: nothing in Arcade can call it.
 */
export {}
