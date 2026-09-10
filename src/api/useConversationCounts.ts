import { useEffect, useMemo, useState } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { useForeignObjects } from '@/api'

/**
 * How many messages each file's conversation holds — the badge on a list row.
 *
 * For the question a reader has in front of a list of files: *is this one worth
 * opening*. One request for the whole set, not one per row: `conversationCountsOf`
 * sends a filter per file in a single POST so each gets its own limit, and the
 * relay meters reads at 300 a minute, which is why the folder read itself
 * fetches no comments at all.
 *
 * ## `undefined` is not zero
 *
 * A file absent from the map was never asked about — no address to ask by, or
 * no manifest to ask with — and a caller must render no badge rather than a
 * confident `0`. The two are different sentences and the map keeps them apart,
 * so this hook does not fill in defaults.
 *
 * ## A zero is not "nobody discussed this"
 *
 * It means nothing is *addressed* to the file. A Peek topic's messages carry
 * `h` and no `a`, so a topic counts zero however busy it is — its conversation
 * belongs to the container rather than the object, until a topic becomes an
 * addressable file (RFC 0.4 §11.1). Ship's issues carry `a` and count properly.
 * So a caller shows the badge where there is something to show and stays quiet
 * otherwise; it must not draw "0 messages" over a topic's real conversation.
 */
export function useConversationCounts(files: ForeignObject[] | undefined): Record<string, number> {
  const { conversationCounts } = useForeignObjects()
  const [counts, setCounts] = useState<Record<string, number>>({})

  /*
    Keyed on the addresses, not the array.

    The folder read returns fresh objects on every refresh, so depending on
    `files` would re-ask the relay on a tick where nothing about the set
    changed. What the count depends on is which files are in it.
  */
  const key = useMemo(
    () =>
      (files ?? [])
        .map((file) => file.address)
        .filter(Boolean)
        .sort()
        .join(','),
    [files],
  )

  useEffect(() => {
    if (!key) {
      setCounts({})
      return
    }
    let cancelled = false
    const asked = (files ?? []).filter((file) => file.address)
    void conversationCounts(asked)
      .then((next) => !cancelled && setCounts(next))
      // A failed count costs a badge, never the list. There is no error state
      // to render here: "we do not know how many" and "we did not ask" are the
      // same absence to a reader, and neither is worth a row of its own.
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // `files` is deliberately not a dependency — `key` is its identity. Adding
    // it would restore the re-ask on every refresh that `key` exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, conversationCounts])

  return counts
}
