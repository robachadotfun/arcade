import {describe, expect, it} from 'vitest'
import {ARCADE_POOL_ID, ARCADE_TOKEN} from './token'
import {ARCADE_POOL_KEY, poolId} from '../../scripts/operator/uniswap-v4'

/**
 * The ARCADE pool key is recovered data, not configuration.
 *
 * A Uniswap v4 pool has no address — it is identified by the hash of its key — so the key
 * cannot be read back from a contract to check it. It was decoded from the pool's `Initialize`
 * event, and the only thing standing between a mistyped digit and a swap against the wrong
 * pool is that the key still hashes to the right id.
 *
 * That check is cheap and total, so it runs in CI rather than only inside the buyback command
 * where it would be discovered while spending money.
 */
describe('ARCADE Uniswap v4 pool key', () => {
  it('hashes to the pool the app targets', () => {
    expect(poolId(ARCADE_POOL_KEY)).toBe(ARCADE_POOL_ID)
  })

  it('has ARCADE as currency0', () => {
    // v4 orders a pool's currencies by address, and every swap direction in the buyback is
    // written against ARCADE being currency0. If that ever flips, `zeroForOne` inverts and a
    // buy becomes a sell.
    expect(ARCADE_POOL_KEY.currency0.toLowerCase()).toBe(ARCADE_TOKEN.address.toLowerCase())
  })

  it('quotes against the 6-decimal USDC ERC-20, not the 18-decimal native asset', () => {
    // Arc exposes USDC at two precisions. Reading this as the native asset would size every
    // swap wrong by twelve orders of magnitude.
    expect(ARCADE_POOL_KEY.currency1.toLowerCase()).toBe(
      '0x3600000000000000000000000000000000000000',
    )
  })
})
