import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { anchorIdsOf, anchorsOf } from '@estiva-app/conversation'
import { fileIdOf, KIND, type SignedEvent } from '@estiva-app/protocol'
import { viewerQuery } from '@/nostr/foreign'
import { hasRelay } from './relayUrl'
import { useRelayViewer } from './foreign'
import { listedNews, listedReadsOf, type ListedFill } from './placeDots'
import type { RowNewsItem } from './rowNews'

/** The most comments one listed file's read asks for: past that, the card's "N more" stops counting. */
const PER_FILE = 100

/** Each lit topic's {@link ListedFill}, by ref, for the rows whose card can read the rest (the Topics column). */
const ListedFills = createContext<Readonly<Record<string, ListedFill>> | undefined>(undefined)

export const ListedFillsProvider = ListedFills.Provider

/** The {@link ListedFill} of the topic `ref`, when the column it is in has one. */
export function useListedFillOf(ref: string): ListedFill | undefined {
  return useContext(ListedFills)?.[ref]
}

/**
 * Every new comment on the files a lit topic lists, as card lines (383a4d3b). The Topics column's cold read holds only
 * each listed file's newest comment, so six comments made while you were away showed as one. Asked only while the
 * card is open, once per card: one read of the lit files' comments after each one's own marker, judged with the same
 * rule and judge that lit the dot (`listedNews`). Nothing on a cold open or a live update. `undefined` until read, and
 * after a refused read, when the card keeps the lines it already had.
 */
export function useListedFill(fill: ListedFill | undefined): RowNewsItem[] | undefined {
  const viewer = useRelayViewer()
  const [read, setRead] = useState<{ key: string; events: readonly SignedEvent[] }>()
  const asks = useMemo(() => (fill ? listedReadsOf(fill) : []), [fill])
  // The files and where each starts: a live update that moves nothing here asks nothing again.
  const key = asks.map((ask) => `${ask.file}@${ask.since}`).join(',')

  useEffect(() => {
    const at = viewer()
    if (!hasRelay || !at || !key || read?.key === key) return
    let live = true
    const filters = asks.flatMap(({ file, since }) => {
      const id = fileIdOf(file)
      return [
        { kinds: [KIND.COMMENT], '#A': [file], since, limit: PER_FILE },
        ...(id ? [{ kinds: [KIND.COMMENT], '#O': [id], since, limit: PER_FILE }] : []),
      ]
    })
    viewerQuery(at.relayUrl, at.token)(filters).then(
      (events) => live && setRead({ key, events: events as readonly SignedEvent[] }),
      // A refused read leaves the card with what the column held.
      () => undefined,
    )
    return () => {
      live = false
    }
    // `asks` is `key`'s source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, viewer])

  return useMemo(() => {
    if (!fill || !read) return undefined
    const held = fill.held.map((entry) => {
      const id = fileIdOf(entry.file)
      const more = read.events.filter((event) => anchorsOf(event).includes(entry.file) || (!!id && anchorIdsOf(event).includes(id)))
      return more.length ? { ...entry, events: merged(entry.events, more) } : entry
    })
    return listedNews(held, fill.judge)
  }, [fill, read])
}

/** Both lists as one, each comment once, oldest first, as the column holds them. */
function merged(held: readonly SignedEvent[], more: readonly SignedEvent[]): readonly SignedEvent[] {
  const byId = new Map<string, SignedEvent>()
  for (const event of [...held, ...more]) byId.set(event.id, event)
  return [...byId.values()].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))
}
