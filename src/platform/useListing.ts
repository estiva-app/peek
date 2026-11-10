import { useCallback, useSyncExternalStore } from 'react'
import type { ListingCache, ListingEntry } from './listingCache'

/**
 * One key of a {@link ListingCache}, kept current in the component (SID-2).
 * `null` asks for nothing and answers `undefined`. Starting a read is the
 * caller's: this only watches what is held.
 */
export function useListing<T, F>(cache: ListingCache<T, F>, key: string | null): ListingEntry<T, F> | undefined {
  const subscribe = useCallback(
    (listener: () => void) => (key === null ? () => {} : cache.subscribe(key, listener)),
    [cache, key],
  )
  const snapshot = useCallback(() => (key === null ? undefined : cache.peek(key)), [cache, key])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
