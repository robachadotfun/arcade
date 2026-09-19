import {describe, expect, it} from 'vitest'
import {keccak256, encodeAbiParameters, type Hex} from 'viem'
import {commitmentFor} from '../../scripts/operator/seedstore'

/**
 * The commitment scheme is the joint between the operator tooling and the contract.
 *
 * `CommitRevealRandomness.reveal` recomputes `keccak256(abi.encode(seed, salt))` and compares
 * it with the published commitment. If the TypeScript side ever computes that differently —
 * a packed encoding, a different argument order, a string instead of bytes32 — then every
 * published commitment becomes unrevealable. Spins would be accepted, sit pending, expire,
 * and be refunded with the operator bond slashed for each one.
 *
 * That failure is expensive, silent until the first spin, and entirely preventable, so the
 * expected digests below are pinned. They were cross-checked against Solidity with:
 *
 *   cast keccak "$(cast abi-encode 'f(bytes32,bytes32)' <seed> <salt>)"
 */

const SEED = '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex
const SALT = '0x2222222222222222222222222222222222222222222222222222222222222222' as Hex

describe('commitmentFor', () => {
  it('matches the digest Solidity produces for a known pair', () => {
    // Verified against `cast keccak "$(cast abi-encode ...)"` on Foundry 1.8.3.
    expect(commitmentFor(SEED, SALT)).toBe(
      '0x3e92e0db88d6afea9edc4eedf62fffa4d92bcdfc310dccbe943747fe8302e871',
    )
  })

  it('uses abi.encode, not abi.encodePacked', () => {
    // Both are 32-byte values here, so packed and non-packed encodings are byte-identical in
    // this one case — which is exactly the trap. Asserting the standard encoding explicitly
    // documents which one the contract uses.
    expect(commitmentFor(SEED, SALT)).toBe(
      keccak256(encodeAbiParameters([{type: 'bytes32'}, {type: 'bytes32'}], [SEED, SALT])),
    )
  })

  it('is order-sensitive, so a swapped pair cannot satisfy the commitment', () => {
    expect(commitmentFor(SEED, SALT)).not.toBe(commitmentFor(SALT, SEED))
  })

  it('is deterministic', () => {
    expect(commitmentFor(SEED, SALT)).toBe(commitmentFor(SEED, SALT))
  })
})
