import { useEffect, useMemo, useState } from 'react'
import { KIND_BARE_FILE, type ConversationMessage, type ForeignObject } from '@estiva-app/interop'
import { KIND, type SignedEvent } from '@estiva-app/protocol'
import { useForeignObjects, useMembership } from '@/api'
import { heldToken, useSessionResumed } from '@/auth/heldSession'
import { fileContext, isCommentOn, isReply, streamHasUnread, THREAD_RULE_FROM } from '@estiva-app/conversation'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { useChannelStreams, useHeldChannelEvents } from './useChannelStreams'
import { listedNews, placeNews, topicFollowingOf, type ListedFill, type ListedNews } from './placeDots'
import { newestFirst, type RowNewsItem } from './rowNews'
import { listingOf, useTeams } from './useTeams'
import { createListingCache } from '@/platform/listingCache'

/** How long a held answer is trusted without asking — the five minutes `HELD_OBJECT_FRESH_MS` holds an object. */
const HELD_BADGES_FRESH_MS = 5 * 60_000

/** `hold`'s answers, by viewer and set. */
const heldBadges = createListingCache<{ conversations: Record<string, ConversationMessage[]> }, true>()

/** A held event's thread root: its `E`, else its first `e`, else itself — interop's `rootOf`. */
const rootOf = (event: SignedEvent) =>
  event.tags.find((t) => t[0] === 'E' && t[1])?.[1] ?? event.tags.find((t) => t[0] === 'e' && t[1])?.[1] ?? event.id

/**
 * A comment's kind. Only `kind:1111`: a `kind:9` counts on a read only where
 * its app's manifest declares it (`commentKindsOf`), which the store's events
 * cannot say — and a `kind:9` carrying a file's `a` is most often a pasted
 * link, a mention (§6.4), which must never light the file's row. A legacy
 * `kind:9` comment still arrives with the next read of the set.
 */
const COMMENT_KINDS: readonly number[] = [KIND.COMMENT]

/**
 * What the tab's channel store holds that the last answer does not, folded
 * into it (OPT-5) by `conversationsOf`'s own rule: a comment is the file's by
 * its `a` (§6.4), and a reply is in a file's thread when it names the file in
 * its `A` and its root is one of that file's comments (CON-34). Only files the
 * answer has an entry for: a file never asked about stays unknown.
 *
 * The store is what the sidebar dots keep live from the socket, so a message
 * said anywhere in the listing's Folders reaches its row with no read.
 */
export function foldHeldEvents(
  answer: Record<string, ConversationMessage[]>,
  files: readonly ForeignObject[],
  events: readonly SignedEvent[],
): Record<string, ConversationMessage[]> {
  const refOf = new Map(files.flatMap((file) => (file.address && answer[file.ref] ? [[file.address, file.ref] as const] : [])))
  if (refOf.size === 0 || events.length === 0) return answer
  const seen = new Set<string>()
  const fileOfRoot = new Map<string, string>()
  for (const [ref, messages] of Object.entries(answer)) {
    for (const m of messages) {
      seen.add(m.id)
      if (m.root === m.id) fileOfRoot.set(m.id, ref)
    }
  }
  const added: Record<string, ConversationMessage[]> = {}
  const add = (ref: string, event: SignedEvent, root: string) => {
    ;(added[ref] ??= []).push({ id: event.id, at: event.created_at, by: event.pubkey, root })
    seen.add(event.id)
  }
  // Only what names a listed file, which is a handful of the store's thousands; ordered as written.
  const naming = events
    .filter((event) => COMMENT_KINDS.includes(event.kind) && !seen.has(event.id) && event.tags.some((t) => (t[0] === 'a' || t[0] === 'A') && refOf.has(t[1])))
    .sort((a, b) => a.created_at - b.created_at)
  // Roots first, then replies — a reply and its root can share a second, and either order.
  for (const event of naming) {
    if (isReply(event)) continue
    const address = event.tags.find((t) => t[0] === 'a' && refOf.has(t[1]) && isCommentOn(event, t[1], COMMENT_KINDS))?.[1]
    if (!address) continue
    const ref = refOf.get(address)!
    add(ref, event, event.id)
    fileOfRoot.set(event.id, ref)
  }
  for (const event of naming) {
    if (seen.has(event.id) || !isReply(event)) continue
    const ref = fileOfRoot.get(rootOf(event))
    if (ref && event.tags.some((t) => t[0] === 'A' && refOf.get(t[1]) === ref)) add(ref, event, rootOf(event))
  }
  if (Object.keys(added).length === 0) return answer
  const out = { ...answer }
  for (const [ref, messages] of Object.entries(added)) out[ref] = [...answer[ref], ...messages]
  return out
}

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
 * ## When it reads (OPT-5)
 *
 * Once per set of addresses — and with `hold`, again only once its answer is
 * five minutes old. What is said afterwards reaches the rows without a read:
 * the answer is folded with what the tab's channel store holds
 * (`foldHeldEvents`), which the socket keeps live. It used to read the whole
 * set again whenever anybody wrote anywhere in its Folder (FOL-44's signal) —
 * 200 messages per file, for one line said.
 */
export function useConversationBadges(
  files: ForeignObject[] | undefined,
  {
    hold = false,
    listed,
  }: {
    hold?: boolean
    /** Your topics' listed files' news, by topic (`useListedNews`): a topic followed at All lights for it too (TOPI-3). */
    listed?: ReadonlyMap<string, ListedNews>
  } = {},
): {
  counts: Record<string, number>
  unread: Record<string, boolean>
  /** A lit topic's or space's card lines, newest first (ACT-3); absent for a row with nothing new, and for other files. */
  news: Record<string, RowNewsItem[]>
  /** A topic lit by its listed files: what lit it there and the judge, for its card to read the rest while open (383a4d3b). */
  fills: Record<string, ListedFill>
} {
  // Read again once a renewal ends a stretch on an expired token (AUT-3).
  const resumed = useSessionResumed()
  const { conversations } = useForeignObjects()
  const frontier = useReadFrontier()
  const membership = useMembership()
  const live = useHeldChannelEvents()
  // A space lights by its team's default: the teams read, one per tab, shared with the Teams column (TEA-6).
  const hasTopic = (files ?? []).some((file) => Number(file.address?.split(':')[0]) === KIND_BARE_FILE)
  const { teams, failed: teamsFailed } = useTeams({ read: hasTopic })
  // Until the teams are read, a space's default is unknown: judged without it, the space would read dark, then light.
  const teamsKnown = !!teams || teamsFailed

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
  const holdKey = hold && key ? `${heldToken()?.pubkey ?? ''} ${key}` : ''
  // A list come back to draws its last answer in its first render (OPT-4).
  const [held, setHeld] = useState<Record<string, ConversationMessage[]>>(
    () => (holdKey && heldBadges.peek(holdKey)?.value?.conversations) || {},
  )

  useEffect(() => {
    if (!key) {
      setHeld({})
      return
    }
    let cancelled = false
    let answered = false
    const asked = (files ?? []).filter((file) => file.address)
    /*
      Nothing held yet: the copy on the device draws the badges until the
      relay's answer lands (PEE-2) — a dot shows as the copy says, rather than
      appearing seconds after the row. Nothing from it is held.
    */
    if (!(holdKey && heldBadges.peek(holdKey)?.value)) {
      void conversations(asked, 'copy')
        .then((cached) => {
          if (!cancelled && !answered && Object.keys(cached).length) setHeld((now) => (Object.keys(now).length ? now : cached))
        })
        .catch(() => {})
    }
    if (holdKey) {
      /*
        Held across mounts, keyed by the viewer and the set: coming back to the
        list draws the last answer and asks nothing. Concurrent mounts share one
        read. Older than a resolved object is held, it is drawn but asked again:
        what the store does not hold — a file in no Folder of this tab's — is
        caught up that way.
      */
      const entry = heldBadges.peek(holdKey)
      if (entry?.value) {
        setHeld(entry.value.conversations)
        if (Date.now() - entry.at < HELD_BADGES_FRESH_MS) return
      }
      void heldBadges
        .read(holdKey, () =>
          conversations(asked).then(
            (next) => ({ ok: true as const, value: { conversations: next } }),
            // A failed read costs a badge, never the list; the last answer stays held.
            () => ({ ok: false as const, failure: true as const }),
          ),
        )
        .then(() => {
          const value = heldBadges.peek(holdKey)?.value
          answered = true
          if (!cancelled && value) setHeld(value.conversations)
        })
      return () => {
        cancelled = true
      }
    }
    void conversations(asked)
      .then((next) => {
        answered = true
        if (!cancelled) setHeld(next)
      })
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
  }, [key, conversations, holdKey, resumed])

  // The answer, with what the socket has said since (OPT-5).
  const current = useMemo(
    () => foldHeldEvents(held, files ?? [], live),
    // `files` only supplies each ref's address; `key` is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [held, live, key],
  )

  /*
    Judged on every frontier change, not only when the messages arrive: the
    frontier moves when this tab records a read, and that is what turns the dot
    off after the pane has been open for a moment. Cheap — a listing's worth of
    messages against a map lookup each.
  */
  return useMemo(() => {
    const counts: Record<string, number> = {}
    const unread: Record<string, boolean> = {}
    /** A lit topic's card: what lit it, newest first (ACT-3). Only topics and spaces have one. */
    const news: Record<string, RowNewsItem[]> = {}
    /** A topic lit by its listed files: what its card reads more of while open (383a4d3b). */
    const fills: Record<string, ListedFill> = {}
    const byRef = new Map((files ?? []).map((file) => [file.ref, file] as const))
    const me = heldToken()?.pubkey
    const nowSeconds = Math.floor(Date.now() / 1000)
    const floor = nowSeconds - PEEK_HORIZON_DAYS * 24 * 60 * 60
    // How `me` follows a topic: its team's default for a space, held by the teams read.
    const followingOfTopic = (address: string, folder: string, me: string) => {
      const team = listingOf(teams, address)?.team
      return topicFollowingOf({
        address,
        folder,
        me,
        changes: membership.changesOf(address),
        floor: membership.floor,
        ...(team?.facts ? { team: { team: team.id, roster: team.facts.roster, listing: team.facts.listing, archived: team.archived, ...(team.facts.teams ? { teams: team.facts.teams } : {}) } } : {}),
      })
    }
    for (const [ref, messages] of Object.entries(current)) {
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
      const file = byRef.get(ref)
      /*
        A topic or a space (TEA-6): the shared place rule at the level the
        viewer follows it at — its team's default for a space, held by the
        teams read. Every other file keeps the membership rule below.
      */
      if (me && file?.address && file.folder && Number(file.address.split(':')[0]) === KIND_BARE_FILE) {
        if (!teamsKnown) continue
        const following = followingOfTopic(file.address, file.folder, me)
        // The lines of the row's card are the dot's own unread messages (ACT-3): lit exactly when there are some.
        const lines = placeNews(
          messages.filter((m) => m.root === m.id || m.at >= THREAD_RULE_FROM),
          {
            context,
            me,
            following,
            muted: membership.termsOf(file.address).muted,
            merged: frontier.merged,
            floor,
            isMentioned: membership.isMentioned,
          },
        )
        unread[ref] = lines.length > 0
        if (lines.length > 0) news[ref] = lines
        continue
      }
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
    /*
      A topic also lights for news on a file it lists (TOPI-3, ACT-2): at either level for what names the viewer there
      or one level under it (a mention, a reply in a conversation they are in), and at All for every new message on a
      file it lists directly. Judged from what the Topics column and the membership read already hold
      (`useListedNews`), with no read of its own; each file in its own stream, so one read in Ship or in the topic
      stays dark.
    */
    if (listed && me && teamsKnown && frontier.ready && membership.state !== 'unknown') {
      for (const file of files ?? []) {
        const held = file.address ? listed.get(file.address) : undefined
        if (!held?.length || !file.folder) continue
        const address = file.address!
        const judge = { me, following: followingOfTopic(address, file.folder, me), muted: membership.termsOf(address).muted, merged: frontier.merged, floor }
        const lines = listedNews(held, judge)
        if (lines.length === 0) continue
        unread[file.ref] = true
        news[file.ref] = newestFirst(news[file.ref] ?? [], lines)
        fills[file.ref] = { held, judge }
      }
    }
    for (const ref of Object.keys(news)) news[ref] = newestFirst(news[ref])
    return { counts, unread, news, fills }
    // `files` only supplies each ref's address; `key` is its identity, as above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, frontier, membership.state, membership.termsOf, membership.isMentioned, membership.changesOf, membership.floor, teams, teamsKnown, key, listed])
}

/**
 * {@link useConversationBadges} for a list with no Folder of its own to take a
 * signal from — the Desk's Open work, whose files come from anywhere.
 *
 * A comment that arrived after the Desk loaded must light its row, or the row
 * looks read, and removing it from open work hands it to the Screener, which
 * says, correctly, that it was not. So the files' Folders are tracked in the
 * tab's channel store — the store the Folder dots already keep current from the
 * socket and the catch-up — and what is said there is folded into the rows
 * with no read (OPT-5).
 *
 * Its answers are held past the Desk (OPT-4): coming back draws the rows' dots
 * from the last answer.
 */
export function useLiveConversationBadges(
  files: ForeignObject[] | undefined,
  { listed }: { listed?: ReadonlyMap<string, ListedNews> } = {},
): ReturnType<typeof useConversationBadges> {
  const folders = useMemo(
    () => [...new Set((files ?? []).flatMap((f) => (f.folder ? [f.folder] : [])))],
    [files],
  )
  useChannelStreams(folders)
  // A topic on the Desk lights as it does in Topics, for its listed files too (ACT-9; Miky, 11 Nov).
  return useConversationBadges(files, { hold: true, listed })
}
