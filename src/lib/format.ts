import {formatUnits} from 'viem'
import {NATIVE_USDC_DECIMALS} from '@/config/network'

/**
 * Formatting helpers.
 *
 * Amount formatting is centralised here for one reason: Arc's two USDC representations have
 * different precision (native = 18 decimals, ERC-20 interface = 6), and reward tokens range
 * from 6 to 18 decimals. Every mis-formatted amount in a product like this is a number a
 * player might act on, so no call site is allowed to guess.
 */

/** Formats a native USDC amount (18 decimals) for display. */
export function formatUsdc(value: bigint, maxFractionDigits = 2): string {
  const asNumber = Number.parseFloat(formatUnits(value, NATIVE_USDC_DECIMALS))
  return asNumber.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFractionDigits,
  })
}

/**
 * Formats a token amount using that token's own decimals.
 *
 * Significant digits adapt to magnitude: a cirBTC reward of 0.00043 must not render as
 * "0.00", and an ARCAT reward of 9,812 does not need four decimal places.
 */
export function formatTokenAmount(value: bigint, decimals: number): string {
  const asNumber = Number.parseFloat(formatUnits(value, decimals))
  return formatDecimalAmount(asNumber)
}

/** Formats an already-decimal token amount with magnitude-appropriate precision. */
export function formatDecimalAmount(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)

  if (abs === 0) return '0'
  if (abs >= 1_000) {
    return value.toLocaleString('en-US', {maximumFractionDigits: 0})
  }
  if (abs >= 1) {
    return value.toLocaleString('en-US', {maximumFractionDigits: 2})
  }
  if (abs >= 0.001) {
    return value.toLocaleString('en-US', {maximumFractionDigits: 4})
  }
  // Small-denomination assets need real precision rather than a rounded zero.
  return value.toLocaleString('en-US', {maximumSignificantDigits: 3})
}

/** Compact USD, for market-data snapshots. Never used in payout maths. */
export function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  if (abs >= 1) return `$${value.toFixed(2)}`
  return `$${value.toPrecision(2)}`
}

export function formatPercent(fraction: number, digits = 2): string {
  if (!Number.isFinite(fraction)) return '—'
  const pct = fraction * 100
  // Keep small probabilities legible: 0.50% should not collapse to 1%.
  const resolved = pct < 1 && pct > 0 ? Math.max(digits, 2) : digits
  return `${pct.toFixed(resolved).replace(/\.?0+$/, '')}%`
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US')
}

/** Shortens an address for display. Full values always remain copyable elsewhere. */
export function shortAddress(address?: string | null, lead = 6, tail = 4): string {
  if (!address) return '—'
  if (address.length <= lead + tail + 2) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}

export function shortHash(hash?: string | null): string {
  return shortAddress(hash, 10, 8)
}

/** Relative time, for the activity tape. */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})
}

export function formatBlock(block: bigint | number | string): string {
  const asNumber = typeof block === 'bigint' ? Number(block) : Number(block)
  if (!Number.isFinite(asNumber)) return String(block)
  return `#${asNumber.toLocaleString('en-US')}`
}
