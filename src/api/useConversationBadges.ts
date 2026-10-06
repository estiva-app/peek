import { useEffect, useMemo, useState } from 'react'
import type { ConversationMessage, ForeignObject } from '@estiva-app/interop'
import { useForeignObjects, useMembership } from '@/api'
import { validToken } from '@/auth/estivaId'
import { fileContext, THREAD_RULE_FROM } from '@estiva-app/conversation'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { streamHasUnread } from './streamUnread'
import { useChannelStreams } from './useChannelStreams'

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
 * ## Only files the person is a member of light a dot (SPEC §11.8)
 *
 * The dot exists only for what you are a member of — created, wrote in, were
 * mentioned in, were placed on, or joined — and only for what was said since
 * you joined. A message that names you lights it through a mute; nothing else
 * does. `counts` is not gated: how much a file holds is the file's fact, not
 * the reader's membership.
 *
 * ## When it re-reads
 *
 * On the set of addresses changing, and on `revision` changing — nothing else.
 * The hook holds no socket of its own: a caller that has a live signal for
 * the files' Folder passes its count (the tree passes `useTeamUnread`'s
 * `activity`, FOL-44), and a caller that passes none reads once per set, as
 * before. Without it, an open section's rows kept their first answer until the
 * section was closed and opened again.
 */
export function useConversationBadges(
  files: ForeignObject[] | undefined,
  revision = 0,
): {
  counts: Record<string, number>
  unread: Record<string, boolean>
} {
  const { conversations } = useForeignObjects()
  const [held, setHeld] = useState<Record<string, ConversationMessage[]>>({})
  const frontier = useReadFrontier()
  const membership = useMembership()

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
  }, [key, conversations, revision])

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
      // Comments, not their replies, which are here for the dot (CON-34): the count `conversationCountsOf` gives.
      counts[ref] = messages.filter((m) => m.root === m.id).length
      // Not judged until the first merge has landed: before that every marker
      // is absent, and "absent" would read as "new" for the whole listing.
      // Nor until the relay has said what the person is a member of (§11.8).
      if (!frontier.ready || membership.state === 'unknown') continue
      const context = fileContext(byRef.get(ref)?.address)
      // The dot exists only for what you are a member of, or are mentioned
      // in: a file the person has no part in judges false however new its talk
      // is. The count above is not gated — "how much is here" is the file's,
      // not the reader's.
      if (!context) continue
      unread[ref] = streamHasUnread(
        // A reply from before the thread rule's cut-over never lit a row, and
        // stays dark (CON-34's Done-when: lit rows the same before and after).
        messages.filter((m) => m.root === m.id || m.at >= THREAD_RULE_FROM),
        context,
        membership.termsOf(context),
        { merged: frontier.merged, me, nowSeconds, horizonSeconds: PEEK_HORIZON_DAYS * 24 * 60 * 60 },
        membership.isMentioned,
      )
    }
    return { counts, unread }
    // `files` only supplies each ref's address; `key` is its identity, as above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, frontier, membership.state, membership.termsOf, membership.isMentioned, key])
}

/**
 * {@link useConversationBadges} for a list with no Folder of its own to take a
 * signal from — the Desk's Open work, whose files come from anywhere.
 *
 * Without a `revision` the badges read once per set, so a comment that arrived
 * after the Desk loaded never lit its row: the row looked read, and removing it
 * from open work handed it to the Screener, which re-reads every minute and
 * said, correctly, that it was not. The revision here is the newest message the
 * tab's channel store holds for the files' Folders — the store the Folder dots
 * already keep current from the socket and the catch-up — so a row re-reads
 * exactly when something was said where it lives, and not on every store tick.
 */
export function useLiveConversationBadges(files: ForeignObject[] | undefined): {
  counts: Record<string, number>
  unread: Record<string, boolean>
} {
  const folders = useMemo(
    () => [...new Set((files ?? []).flatMap((f) => (f.folder ? [f.folder] : [])))],
    [files],
  )
  const { streams } = useChannelStreams(folders)
  const revision = useMemo(() => {
    let newest = 0
    for (const messages of Object.values(streams)) {
      for (const message of messages) if (message.at > newest) newest = message.at
    }
    return newest
  }, [streams])
  return useConversationBadges(files, revision)
}
