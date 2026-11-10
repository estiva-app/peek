import { useEffect, useMemo, useState } from 'react'
import { viewerQuery } from '@/nostr/foreign'
import { hasRelay } from './relayUrl'
import { useRelayViewer, useResolvedReferences } from './foreign'
import { CARD_LINES, type RowNewsItem } from './rowNews'

/**
 * What a lit row's card needs that its dot did not read (ACT-3): the words of a topic's own messages (the Topics
 * column reads them without their text) and the titles of the files a topic lists. Asked only while the card is
 * open (the card's content mounts with it), for the lines it shows: one read of at most five messages by id, and one
 * pooled read of their files, shared with every other title on screen. Nothing on a cold open or a live update.
 */
export function useRowNewsDetails(items: readonly RowNewsItem[]): {
  wordsOf: (item: RowNewsItem) => string | undefined
  titleOf: (file: string) => string | undefined
} {
  const shown = items.slice(0, CARD_LINES)
  const missing = shown.filter((item) => item.words === undefined).map((item) => item.id)
  const files = [...new Set(shown.flatMap((item) => (item.file ? [item.file] : [])))]
  const objects = useResolvedReferences(files)
  const viewer = useRelayViewer()
  const key = missing.join(',')
  const [read, setRead] = useState<{ key: string; words: ReadonlyMap<string, string> } | null>(null)

  useEffect(() => {
    const at = viewer()
    if (!hasRelay || !at || !key) return
    let live = true
    const ids = key.split(',')
    viewerQuery(at.relayUrl, at.token)([{ ids, limit: ids.length }]).then(
      (events) => live && setRead({ key, words: new Map(events.map((event) => [event.id, event.content])) }),
      // A refused read leaves the line without its words; who, what and when still say why the row is lit.
      () => live && setRead({ key, words: new Map() }),
    )
    return () => {
      live = false
    }
  }, [key, viewer])

  return useMemo(
    () => ({
      wordsOf: (item: RowNewsItem) => item.words ?? (read?.key === key ? read.words.get(item.id) : undefined),
      titleOf: (file: string) => {
        const object = objects[file]
        return object ? (object.slots.title?.value ?? 'Untitled') : undefined
      },
    }),
    [read, key, objects],
  )
}
