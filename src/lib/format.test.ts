import {describe, expect, it} from 'vitest'
import {
  formatUsdc,
  formatTokenAmount,
  formatDecimalAmount,
  formatPercent,
  shortAddress,
  relativeTime,
} from './format'
import {NATIVE_USDC_DECIMALS, ERC20_USDC_DECIMALS} from '@/config/network'

/**
 * Formatting is where Arc's two USDC representations (18-decimal native, 6-decimal ERC-20)
 * and 6-to-18 decimal reward tokens could silently mis-size a number a user acts on. These
 * tests pin the decimal handling down.
 */

describe('USDC formatting', () => {
  it('formats native USDC using 18 decimals', () => {
    expect(NATIVE_USDC_DECIMALS).toBe(18)
    expect(formatUsdc(2_000_000_000_000_000_000n)).toBe('2.00')
    expect(formatUsdc(1_500_000_000_000_000_000n)).toBe('1.50')
  })

  it('does not confuse native precision with the ERC-20 interface', () => {
    expect(ERC20_USDC_DECIMALS).toBe(6)
    // 2 USDC in 6-decimal units is a vanishingly small native amount, and must not read as 2.
    expect(formatUsdc(2_000_000n)).not.toBe('2.00')
  })
})

describe('token amount formatting', () => {
  it('respects each token’s own decimals', () => {
    // 18 decimals (ARGUS-like)
    expect(formatTokenAmount(4_820_000_000_000_000_000_000n, 18)).toBe('4,820')
    // 8 decimals (cirBTC-like)
    expect(formatTokenAmount(43_000n, 8)).toBe('0.00043')
    // 6 decimals (EURC-like)
    expect(formatTokenAmount(2_500_000n, 6)).toBe('2.5')
  })

  it('never rounds a small-denomination reward to zero', () => {
    const formatted = formatTokenAmount(12_000n, 8) // 0.00012 cirBTC
    expect(formatted).not.toBe('0')
    expect(formatted).not.toBe('0.00')
  })

  it('formats large amounts without exponent notation', () => {
    expect(formatDecimalAmount(28_000)).toBe('28,000')
    expect(formatDecimalAmount(1_234_567)).not.toContain('e')
  })
})

describe('formatPercent', () => {
  it('keeps sub-one-percent odds legible', () => {
    // A 0.5% jackpot must not collapse to 1% or 0%.
    expect(formatPercent(0.005)).toBe('0.5%')
    expect(formatPercent(0.001)).toBe('0.1%')
  })

  it('formats whole percentages cleanly', () => {
    expect(formatPercent(0.7)).toBe('70%')
    expect(formatPercent(0.24)).toBe('24%')
    expect(formatPercent(1)).toBe('100%')
  })
})

describe('shortAddress', () => {
  it('shortens a full address', () => {
    expect(shortAddress('0xece5ca8bf9220718e5727754026757512212cb3c')).toBe('0xece5…cb3c')
  })

  it('returns a dash for a missing value rather than throwing', () => {
    expect(shortAddress(undefined)).toBe('—')
    expect(shortAddress(null)).toBe('—')
  })

  it('leaves an already-short value alone', () => {
    expect(shortAddress('0x1234')).toBe('0x1234')
  })
})

describe('relativeTime', () => {
  const now = 1_700_000_000_000

  it('describes recent events', () => {
    expect(relativeTime(now - 1_000, now)).toBe('just now')
    expect(relativeTime(now - 30_000, now)).toBe('30s ago')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago')
  })

  it('never reports a negative duration for a clock skew', () => {
    expect(relativeTime(now + 10_000, now)).toBe('just now')
  })
})
