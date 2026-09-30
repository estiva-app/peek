import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { resolveParentsAsViewer } from '@/nostr/foreign'
import { relayLog } from '@/nostr/liveTopics'
import { withRateLimitRetry } from '@/nostr/relayRead'
import { useRelayViewer } from './foreign'

/**
 * The parent each file sits under, read once per file per tab — FOL-50.
 *
 * The Folder dots place a file's talk in the Folder whose state lists it
 * (FOL-49), and no state lists an issue: it is reached through its project. So
 * a comment on an issue of a moved project was judged in the Folder the project
 * left. This is how the dots learn the project — interop's `resolveParents`,
 * which reads the roots and the moves and folds them by the rule the card and
 * the listing use, so an issue moved to another project follows it too.
 *
 * ## Once per file, not per read
 *
 * Measured on production on 2026-09-30: the dots named 110 issues no state
 * lists, and their parents were one POST and ~500 KB — the roots carry the
 * descriptions, and a relay cannot be asked for one field of a change. The
 * channel read beside it is 2.3 MB on every load, but this is still not worth
 * repeating on every socket signal, so a file is asked about once per viewer
 * per tab and only the files not asked about yet go to the relay after that.
 * An issue re-parented while the tab is open is placed by its old project until
 * the next load; a project moved between Folders is not affected, because
 * where a project lives is the Folder state the listing re-reads.
 *
 * A refused read is logged and forgotten, and so is a file the relay could say
 * nothing about, so the next change in what the dots name asks again; until
 * then those files stay where they are talked about, which is what they did
 * before this existed.
 */
let cache: { viewer: string; parents: Map<string, string | null>; asked: Set<string> } | null = null
let version = 0
const listeners = new Set<() => void>()

function cacheFor(viewer: string) {
  if (cache?.viewer !== viewer) cache = { viewer, parents: new Map(), asked: new Set() }
  return cache
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const currentVersion = () => version

function changed(): void {
  version += 1
  for (const listener of listeners) listener()
}

/** Tests only: forget every parent, so each test starts with none asked. */
export function resetFileParentsForTests(): void {
  cache = null
  version = 0
}

/**
 * Each address's parent, for the ones answered so far: the parent's address,
 * or `null` for a file at the top. No key for a file not answered yet, or one
 * the relay could tell nothing about.
 */
export function useFileParents(addresses: readonly string[]): Readonly<Record<string, string | null>> {
  const viewer = useRelayViewer()
  const seen = useSyncExternalStore(subscribe, currentVersion)

  // Keyed on the addresses, not the array: the caller derives a fresh one per render.
  const key = useMemo(() => [...new Set(addresses)].sort().join(','), [addresses])

  useEffect(() => {
    const v = viewer()
    if (!v || !key) return
    const held = cacheFor(`${v.relayUrl}|${v.token.pubkey}`)
    const missing = key.split(',').filter((address) => !held.asked.has(address))
    if (missing.length === 0) return
    for (const address of missing) held.asked.add(address)
    withRateLimitRetry(() => resolveParentsAsViewer(missing, v.relayUrl, v.token)).then(
      (parents) => {
        if (cache !== held) return
        for (const address of missing) {
          // Nothing to tell yet — a root not indexed, a manifest missed — is
          // asked again with the next file the dots name, not never.
          if (address in parents) held.parents.set(address, parents[address])
          else held.asked.delete(address)
        }
        changed()
      },
      (error) => {
        relayLog('file parents read failed', error)
        for (const address of missing) held.asked.delete(address)
      },
    )
  }, [key, viewer])

  return useMemo(() => {
    const v = viewer()
    const held = v && cache?.viewer === `${v.relayUrl}|${v.token.pubkey}` ? cache.parents : undefined
    const out: Record<string, string | null> = {}
    if (!held || !key) return out
    for (const address of key.split(',')) if (held.has(address)) out[address] = held.get(address)!
    return out
    // `seen` is the store's version: a new answer is a new snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, viewer, seen])
}
