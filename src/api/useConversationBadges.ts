import { useEffect, useMemo, useState } from 'react'
import type { ConversationMessage, ForeignObject } from '@estiva-app/interop'
import { useFollows, useForeignObjects } from '@/api'
import { validToken } from '@/auth/estivaId'
import { fileContext, PEEK_HORIZON_DAYS, threadContext } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { fileHasUnread } from './fileUnread'

/**
 * The badges on a list of files: how many messages each conversation holds,
 * and whether it holds something the viewer has not read.
 *
 * For the question a reader has in front of a list of files: *is this one worth
 * opening*, and since FOL-16, *is there something new in it*. One request for
 * the whole set, not one per row: `conversationsOf` sends a filter per file in a
 * single POST so each gets its own limit, and the relay meters reads at 300 a
 * minute, which is why the folder read itself fetches no comments at all.
 *
 * ## `undefined` is not zero
 *
 * A file absent from `counts` was never asked about — no address to ask by, or
 * no manifest to ask with — and a caller must render no badge rather than a
 * confident `0`. The two are different sentences and the map keeps them apart,
 * so this hook does not fill in defaults. `unread` is the same: a file absent
 * from it was not judged, which is not "nothing new".
 *
 * ## A zero is not "nobody discussed this"
 *
 * It means nothing is *addressed* to the file. A Peek topic's messages carry
 * `h` and no `a`, so a topic counts zero however busy it is — its conversation
 * belongs to the container rather than the object, until a topic becomes an
 * addressable file (RFC 0.4 §11.1). Ship's issues carry `a` and count properly.
 * So a caller shows the badge where there is something to show and stays quiet
 * otherwise; it must not draw "0 messages" over a topic's real conversation.
 *
 * ## Unread is judged against the file's own marker, never the channel's
 *
 * SPEC §11.1–§11.3 (FOL-16): a file's conversation is its own stream and the
 * bare address is its frontier. The Folder's channel marker does not reach it,
 * so the dot on an issue survives somebody reading the team's general chat and
 * goes out only when *this* file's talk was read — here, or in Ship, which
 * advances the same address. The frontier comes from the relay merge rather
 * than Convex, which has no watermark for a file; `fileHasUnread` says how
 * absence is read.
 *
 * ## Only followed files are judged (FOL-30)
 *
 * The dot exists only for what you follow. A file the person does not follow
 * has no `unread` entry — not judged, like an unasked one — and the listing
 * draws nothing for it however new its talk is. `counts` is not gated: how
 * much a file holds is the file's fact, not the reader's subscription.
 */
export function useConversationBadges(files: ForeignObject[] | undefined): {
  counts: Record<string, number>
  unread: Record<string, boolean>
} {
  const { conversations } = useForeignObjects()
  const [held, setHeld] = useState<Record<string, ConversationMessage[]>>({})
  const frontier = useReadFrontier()
  const follows = useFollows()

  /*
    Keyed on the addresses, not the array.

    The folder read returns fresh objects on every refresh, so depending on
    `files` would re-ask the relay on a tick where nothing about the set
    changed. What the badges depend on is which files are in it.
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
      setHeld({})
      return
    }
    let cancelled = false
    const asked = (files ?? []).filter((file) => file.address)
    void conversations(asked)
      .then((next) => !cancelled && setHeld(next))
      // A failed read costs a badge, never the list. There is no error state
      // to render here: "we do not know how many" and "we did not ask" are the
      // same absence to a reader, and neither is worth a row of its own.
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // `files` is deliberately not a dependency — `key` is its identity. Adding
    // it would restore the re-ask on every refresh that `key` exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, conversations])

  /*
    Judged on every frontier change, not only when the messages arrive: the
    frontier moves when this tab records a read, and that is what turns the dot
    off after the pane has been open for a moment. Cheap — a listing's worth of
    messages against a map lookup each.
  */
  return useMemo(() => {
    const counts: Record<string, number> = {}
    const unread: Record<string, boolean> = {}
    const byRef = new Map((files ?? []).map((file) => [file.ref, file] as const))
    const me = validToken()?.pubkey
    const nowSeconds = Math.floor(Date.now() / 1000)
    for (const [ref, messages] of Object.entries(held)) {
      counts[ref] = messages.length
      // Not judged until the first merge has landed: before that every marker
      // is absent, and "absent" would read as "new" for the whole listing.
      // Nor until the relay has said what the person follows (FOL-30).
      if (!frontier.ready || follows.state === 'unknown') continue
      const address = byRef.get(ref)?.address
      // The dot exists only for what you follow: an unfollowed file is not
      // judged, and its row draws nothing however new its talk is. The count
      // above is not gated — "how much is here" is the file's, not the reader's.
      if (!address || !follows.isFollowed(address)) continue
      unread[ref] = fileHasUnread(messages, {
        file: frontier.marker(fileContext(address)),
        thread: (root) => frontier.marker(threadContext(root)),
        me,
        nowSeconds,
        horizonSeconds: PEEK_HORIZON_DAYS * 24 * 60 * 60,
      })
    }
    return { counts, unread }
    // `files` only supplies each ref's address; `key` is its identity, as above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, frontier, follows.state, follows.isFollowed, key])
}
