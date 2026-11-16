import { useEffect, useState } from 'react'
import { fileTopicsAsViewer } from '@/nostr/foreign'
import { useRelayViewer } from './foreign'
import { hasRelay } from './relayUrl'

/** A file's id, the `d` of its address `<kind>:<pubkey>:<d>`. */
const dOf = (address: string) => address.split(':').slice(2).join(':')

/**
 * The topics that list any of these files (B-04): for another app's file on its page, the file itself and its project,
 * so its header names the initiatives it is in (Katerina, 16 November, F-05). Read once each time the files change, as
 * the viewer. `undefined` until it answers, and when it could not be read: no chips, rather than a guess.
 */
export function useFileTopics(files: readonly (string | null | undefined)[]): ReadonlySet<string> | undefined {
  const viewer = useRelayViewer()
  const key = files.filter((file): file is string => !!file).join(',')
  const [read, setRead] = useState<{ key: string; topics: ReadonlySet<string> } | null>(null)
  useEffect(() => {
    const v = viewer()
    if (!hasRelay || !v || !key) return
    let cancelled = false
    Promise.all(key.split(',').map((address) => fileTopicsAsViewer(dOf(address), v.relayUrl, v.token)))
      .then((lists) => {
        if (!cancelled) setRead({ key, topics: new Set(lists.flat()) })
      })
      .catch((error: unknown) => console.warn('[nostr] file topics read failed:', error))
    return () => {
      cancelled = true
    }
  }, [viewer, key])
  return read?.key === key ? read.topics : undefined
}
