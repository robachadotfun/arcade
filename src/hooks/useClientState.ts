'use client'

import {useCallback, useSyncExternalStore} from 'react'

/**
 * Client-only state helpers built on `useSyncExternalStore`.
 *
 * ## Why not `useState` + `useEffect`
 *
 * The obvious way to read browser-only state is a `mounted` flag flipped in an effect. That
 * works, but it forces a second render pass on every mount, and the React Compiler flags it
 * as a cascading render. `useSyncExternalStore` is the API built for this case: it takes a
 * distinct server snapshot, so the server render and the first client render agree without
 * routing through an effect.
 */

function noopSubscribe() {
  return () => {}
}

/**
 * True once the component has hydrated on the client.
 *
 * Gate anything depending on `window`, a wallet provider, or local storage behind this so
 * the server render and the first client render produce identical markup.
 */
export function useIsMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
}

// --------------------------------------------------------------------- local storage

const listeners = new Set<() => void>()
/** Bumped on every write, so snapshots know when a cached parse is stale. */
let epoch = 0

/**
 * Cache of parsed values, keyed by parser and then by storage key.
 *
 * `useSyncExternalStore` requires a referentially stable snapshot — returning a freshly
 * parsed object on every call would make it re-render forever.
 *
 * The outer key is the parse function, not just the storage key. Two call sites reading the
 * same key with different parsers expect different shapes, and a key-only cache would hand
 * one of them the other's value.
 */
type ParseFn = (raw: string | null) => unknown
const cache = new WeakMap<ParseFn, Map<string, {epoch: number; value: unknown}>>()

function cacheFor(parse: ParseFn): Map<string, {epoch: number; value: unknown}> {
  const existing = cache.get(parse)
  if (existing) return existing
  const created = new Map<string, {epoch: number; value: unknown}>()
  cache.set(parse, created)
  return created
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange)
  // `storage` only fires for other tabs, so same-tab writes are announced via invalidate().
  window.addEventListener('storage', onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
    window.removeEventListener('storage', onStoreChange)
  }
}

/**
 * Announces that local storage changed in this tab.
 *
 * Call after any `setItem`/`removeItem` whose value is rendered, otherwise subscribers keep
 * showing the cached parse.
 */
export function invalidateLocalStorage(): void {
  // Bumping the epoch is enough to stale every cached entry; the per-parser maps are small
  // and self-correcting, and a WeakMap cannot be cleared wholesale anyway.
  epoch += 1
  for (const listener of listeners) listener()
}

/** Reads a raw key, tolerating storage being unavailable. */
export function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    // Private browsing, blocked site data, previews: treat as absent rather than throwing.
    return null
  }
}

/** Writes a key and notifies subscribers. Returns false when storage is unavailable. */
export function safeSetItem(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value)
    invalidateLocalStorage()
    return true
  } catch {
    return false
  }
}

/** Removes a key and notifies subscribers. */
export function safeRemoveItem(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Nothing to do.
  }
  invalidateLocalStorage()
}

/**
 * Reads a parsed value out of local storage, re-reading whenever it changes.
 *
 * @param key    the storage key
 * @param parse  must be a stable function reference (module scope or `useCallback`) and must
 *               be pure — it is called during snapshot reads
 * @param serverValue what to render before hydration
 */
export function useLocalStorageValue<T>(
  key: string,
  parse: (raw: string | null) => T,
  serverValue: T,
): T {
  const getSnapshot = useCallback((): T => {
    const entries = cacheFor(parse as ParseFn)
    const cached = entries.get(key)
    if (cached && cached.epoch === epoch) return cached.value as T

    const parsed = parse(safeGetItem(key))
    entries.set(key, {epoch, value: parsed})
    return parsed
  }, [key, parse])

  const getServerSnapshot = useCallback(() => serverValue, [serverValue])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
