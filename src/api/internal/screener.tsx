/**
 * The Screener — both halves folded here from the relay, the decisions on the
 * relay too (SHR-10, FOL-34, CON-14).
 *
 * A snooze and a dismissal are the person's, so they live in their own
 * `estiva-peek:screener:v1` blob and nowhere else — for a DM row as for a file
 * row, under `screenerKey`'s `dm:` and `file:` prefixes.
 *
 * ## The rules, and where each input comes from
 *
 * | Rule | Decided by |
 * |---|---|
 * | 1 — someone DMs you (CON-14) | `foldDmScreenerRows`, from the channel store the DM dots read |
 * | a file you are a member of got a comment you have not read (FOL-34, §11.8) | `foldFileScreenerRows`, from the relay |
 *
 * Rules 2 and 3 and the refresh rule judged Convex topics, folded here from
 * `screener.candidates`; they went with the topics in FOL-23.
 *
 * The file row is relay-only end to end: a file's `kind:1111` conversation
 * never enters Convex, and nothing was added to Convex to make it (ADR 0001 —
 * the conversation is the relay's, and the rule is the unread dot's, which is
 * already computed here from the read frontier). One row per conversation,
 * carrying the newest screening event's preview.
 *
 * ## The DM half (CON-14)
 *
 * Until CON-14 DMs came from `desk.screenerList`, rows `messages.send` wrote —
 * and nothing had written one since REM-1 sent DMs to the relay, so a new DM
 * never screened. The DM half now reads what the sidebar's DM dots already
 * hold: every DM channel's messages, kept by the tab's channel store
 * (`useChannelStreams`). It costs no read of its own, and a row lights and
 * clears with the dot, because it is the dot's rule (`foldDmScreenerRows`).
 *
 * Both halves check the open-work **list**, not its rows (PEE-6), and are
 * merged newest first.
 *
 * ## The hover preview
 *
 * `previewOf` hands the card what the fold already holds: a DM row's thread
 * from the channel store, and a file row's screening comment, whose replies
 * the card reads on hover (`useScreenerPreview`). Nothing is asked of Convex.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SCREENER_ITEMS } from '@/data/screenerData'
import { useOpenWork } from '@/api/internal/openWork'
import { useDmChannels } from '@/api/internal/dms'
import { useWorkspacePeople } from '@/api/people'
import { useChannelStreams } from '@/api/useChannelStreams'
import type { StreamMessage } from '@/nostr/channelStreams'
import { useMembership } from '@/api/internal/membership'
import { useForeignObjects } from '@/api/foreign'
import { validToken } from '@/auth/estivaId'
import { useScreenerSync } from '@/nostr/useScreenerSync'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { screenerKey, type InstantMap } from '@/nostr/screener'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import {
  dmPartnerFromScreenerRowId,
  dmPreviewMessages,
  fileAddressFromScreenerRowId,
  foldDmScreenerRows,
  foldFileScreenerRows,
  foldUrgentFiles,
  type FoldedUrgentFile,
  type ScreenerDm,
  type ScreenerFile,
} from '@/api/internal/screenerFold'
import type { ScreenerItem } from '@/api/types'
import { RELAY_URL, hasRelay } from '@/api/relayUrl'

export interface ScreenerValue {
  /** The rows, newest screening event first. */
  items: ScreenerItem[]
  /** True until every source has settled. Drives the Desk skeleton. */
  isLoading: boolean
  /** Dismiss a row — a watermark at `now` for its conversation, not a deletion. */
  dismiss: (rowId: string, nowMs: number) => void
  /** "Later" on a row: it comes back at `untilMs`. */
  snooze: (rowId: string, untilMs: number) => void
  /** What the hover card starts from, for a row on screen; undefined for any other id. */
  previewOf: (rowId: string) => ScreenerPreviewSource | undefined
  /** Files with an unread urgent comment for the viewer, newest first — Desk's Urgent (CON-17). */
  urgentFiles: FoldedUrgentFile[]
}

/** The fold's own facts about a row, handed to the hover card (CON-14). */
export type ScreenerPreviewSource =
  /** The screening message's thread, from the channel store, oldest first. */
  | { kind: 'dm'; messages: StreamMessage[] }
  /** The screening comment; its replies are the card's to read. */
  | { kind: 'file'; address: string; comment: ScreenerFile['comments'][number] }

/**
 * How often the file half re-reads while the Desk is visible (FOL-34).
 *
 * Slower than `REFRESH_INTERVAL_MS` because it was one relay request per
 * member file, against a quota of 300 a minute per person that every open
 * tab shares. Since PER-10 the whole set is one request, so this could come
 * down; it has not, because nothing asked for fresher file rows. Focus and
 * visibility still re-read at once, which is the moment somebody actually looks.
 */
const FILE_REFRESH_MS = 60_000

/**
 * The files the Screener judges — the ones the person is a member of — read
 * from the relay (FOL-34, CON-19).
 *
 * A file's conversation never enters Convex, so this half has no server-side
 * candidates to fold: it asks the relay for the member files directly — every
 * file's title and top-level comments in one read (PER-10) — and
 * `foldFileScreenerRows` decides which of them screen. `[]` until asked: a
 * missing file row is the quiet failure, and a Desk held under a skeleton for a
 * relay that is down is the loud one.
 */
function useMemberFiles(addresses: readonly string[]): ScreenerFile[] {
  const { resolveObjects } = useForeignObjects()
  /*
    Held per address, not per set. The set changes whenever a file enters or
    leaves open work — "Open" on a Screener row does exactly that — and holding
    one answer for the whole set meant every other file row vanished until a
    fresh read of all of them came back: the Screener flashed on every Open.
    Now a change to the set asks only about addresses not yet held, and an
    address that left the set is simply not returned.
  */
  const [held, setHeld] = useState<Record<string, ScreenerFile | null>>({})
  const heldRef = useRef(held)
  useEffect(() => {
    heldRef.current = held
  }, [held])
  const key = addresses.join('\u0000')

  const read = useCallback(
    (asked: readonly string[]) => {
      if (!hasRelay || asked.length === 0) return
      resolveObjects(asked).then(
        (objects) =>
          setHeld((prev) => {
            const next = { ...prev }
            for (const address of asked) {
              const object = objects[address]
              next[address] = object
                ? { address, kind: object.kind, title: object.slots.title?.value ?? 'File', comments: object.comments }
                : null
            }
            return next
          }),
        // A refused read keeps what was held rather than blanking every file
        // row at once. Before PER-10 each resolve swallowed its own refusal as
        // "no such file", so a rate-limited minute emptied the rows it hit.
        () => {},
      )
    },
    [resolveObjects],
  )

  // The set changed: ask only about what is not held yet.
  useEffect(() => {
    const asked = key ? key.split('\u0000').filter((address) => !(address in heldRef.current)) : []
    // The copy on the device first, for what it holds; the relay's answer replaces it (PEE-2).
    if (hasRelay && asked.length) {
      resolveObjects(asked, 'copy').then(
        (objects) =>
          setHeld((prev) => {
            const found = asked.filter((address) => !(address in prev) && objects[address])
            if (!found.length) return prev
            const next = { ...prev }
            for (const address of found) {
              const object = objects[address]!
              next[address] = { address, kind: object.kind, title: object.slots.title?.value ?? 'File', comments: object.comments }
            }
            return next
          }),
        () => {},
      )
    }
    read(asked)
  }, [key, read, resolveObjects])
  // A refresh re-reads everything in the set — that is how new comments arrive.
  useRefreshTriggers(() => read(key ? key.split('\u0000') : []), {
    enabled: hasRelay && !!key,
    intervalMs: FILE_REFRESH_MS,
  })

  return useMemo(
    () => addresses.flatMap((address) => (held[address] ? [held[address]] : [])),
    [addresses, held],
  )
}

const ScreenerContext = createContext<ScreenerValue | null>(null)

const NO_CHANNELS: readonly string[] = []

/** The decisions-blob key a row's conversation is recorded under, or null for an id no fold made. */
function keyOfRow(rowId: string): string | null {
  const partner = dmPartnerFromScreenerRowId(rowId)
  if (partner) return screenerKey('dm', partner)
  const address = fileAddressFromScreenerRowId(rowId)
  return address ? screenerKey('file', address) : null
}

/** A decision made this session, applied over the settled maps until they catch up. */
type Pending = { snoozed: InstantMap; dismissed: InstantMap }
const NO_PENDING: Pending = { snoozed: {}, dismissed: {} }

/**
 * How often the Screener re-reads the clock, so a snooze that expires while the
 * Desk is open brings its row back on its own.
 *
 * "Later" is coarse by design (§2.12 — the choices are hours), so a minute of
 * lateness is invisible and a `setInterval` a minute apart costs nothing. The
 * clock lives in state rather than being read inside the memo because
 * `Date.now()` in a memo is impure under the React Compiler's rules — and
 * because a memo that reads the clock would only ever re-evaluate when
 * something *else* changed, which for a Desk left open is never.
 */
const CLOCK_TICK_MS = 60_000

export function ScreenerProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending>(NO_PENDING)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  // Where the relay lives — a build-time value since REM-2 (`@/api/relayUrl`).
  const relayUrl = RELAY_URL
  const sync = useScreenerSync(relayUrl)

  const openWork = useOpenWork()

  /*
    The DM half (CON-14): every DM channel the relay says the viewer has, read
    through the same store as the DM dots (`useUnread`), so tracking them here
    adds no request. Named from the roster, kept for partners who left it.
  */
  const { partners, channelOf } = useDmChannels()
  const dmChannelIds = useMemo(
    () => partners.flatMap((pubkey) => (channelOf(pubkey) ? [channelOf(pubkey) as string] : [])),
    [partners, channelOf],
  )
  const dmStreams = useChannelStreams(hasRelay ? dmChannelIds : NO_CHANNELS)
  const people = useWorkspacePeople(partners)
  const dms = useMemo<ScreenerDm[]>(() => {
    const byKey = new Map((people ?? []).map((p) => [p.id, p]))
    return partners.flatMap((partner) => {
      const channel = channelOf(partner)
      const messages = channel ? dmStreams.streams[channel] : undefined
      const person = byKey.get(partner)
      // Not answered yet, or nobody to name: no row, as for an unresolved file.
      if (!channel || !messages || !person) return []
      return [{ partner, channel, authorName: person.name, authorAvatarSrc: person.avatarSrc, messages }]
    })
  }, [partners, channelOf, dmStreams.streams, people])

  /** The decisions as last settled, before this session's changes. */
  const settled = useMemo<Pending | undefined>(() => {
    if (sync.state === 'present' && sync.relayBlob) {
      return { snoozed: sync.relayBlob.snoozed, dismissed: sync.relayBlob.dismissed }
    }
    // Nothing to seed from: the Convex snoozes that used to seed this were
    // topics' (`desk.topicSnoozes`), and went with them in FOL-23.
    if (sync.state === 'absent') return NO_PENDING
    // The relay was asked and the answer is not coming. Render without the
    // decisions rather than hold the Desk under a skeleton for the rest of the
    // load — a Screener that never appears is a worse failure than one showing
    // a row the person dismissed, and `useScreenerSync` refuses to publish in
    // this state, so the decisions on the relay are not at risk.
    if (sync.state === 'unreachable') return NO_PENDING
    // `unknown`. Not asked at all is an empty pair the person can still act on;
    // asked and unanswered renders nothing yet, because pulling a dismissed row
    // back a second later is a flicker on every load.
    return sync.asked ? undefined : NO_PENDING
  }, [sync.state, sync.relayBlob, sync.asked])

  /**
   * Until the relay answers, the decisions the copy on the device holds are
   * drawn (PEE-2) — so a reload shows the rows as they were, not a skeleton.
   * They are never published: only `settled` is.
   */
  const shown = useMemo<Pending | undefined>(() => {
    if (settled) return settled
    if (sync.state !== 'unknown' || !sync.cachedBlob) return undefined
    return { snoozed: sync.cachedBlob.snoozed, dismissed: sync.cachedBlob.dismissed }
  }, [settled, sync.state, sync.cachedBlob])

  const effective = useMemo<Pending | undefined>(() => {
    if (!shown) return undefined
    // A decision made this session always wins over the settled one: both maps
    // only ever move forward, and the later instant is the one the person just
    // chose. `Math.max` rather than an overwrite so a stale settled value that
    // arrives after the click cannot undo it.
    const merge = (base: InstantMap, over: InstantMap): InstantMap => {
      const out: InstantMap = { ...base }
      for (const [key, value] of Object.entries(over)) out[key] = Math.max(out[key] ?? 0, value)
      return out
    }
    return { snoozed: merge(shown.snoozed, pending.snoozed), dismissed: merge(shown.dismissed, pending.dismissed) }
  }, [shown, pending])

  /*
    The file half (FOL-34). The files the person is a member of (§11.8) are
    asked about, by address. A file already in open work is not asked about at
    all — PEE-6 would drop its row anyway, and the read is the expensive part.
    Nothing is judged before the relay has said what the person is a member
    of, for the reason `useConversationBadges` gives.
  */
  const membership = useMembership()
  const frontier = useReadFrontier()
  const memberFiles = useMemo(
    () =>
      membership.state === 'unknown'
        ? []
        : membership.memberFiles.filter((key) => !openWork.fileAddresses.has(key)),
    [membership.state, membership.memberFiles, openWork.fileAddresses],
  )
  const files = useMemberFiles(memberFiles)

  const { items, previews } = useMemo<{ items: ScreenerItem[]; previews: Map<string, ScreenerPreviewSource> }>(() => {
    const previews = new Map<string, ScreenerPreviewSource>()
    if (!hasRelay) return { items: SCREENER_ITEMS, previews }
    if (!effective) return { items: [], previews }

    // Not judged until the read-state merge has landed: before it every marker
    // is absent, and absent reads as "new" for every member file — and every
    // DM — at once.
    if (!frontier.ready) return { items: [], previews }
    const me = validToken()?.pubkey
    const horizonSeconds = PEEK_HORIZON_DAYS * 24 * 60 * 60

    const dmRows = foldDmScreenerRows(
      dms,
      effective,
      openWork.dmIds,
      { marker: frontier.marker, me, nowSeconds: Math.floor(now / 1000), horizonSeconds },
      now,
    )
    const messagesOf = new Map(dms.map((dm) => [dm.partner, dm.messages]))
    for (const row of dmRows) {
      previews.set(row.item.id, {
        kind: 'dm',
        messages: dmPreviewMessages(messagesOf.get(row.item.dmId) ?? [], row.messageId),
      })
    }

    const fileRows = foldFileScreenerRows(
      files,
      effective,
      openWork.fileAddresses,
      {
        merged: frontier.merged,
        termsOf: membership.termsOf,
        isMentioned: membership.isMentioned,
        me,
        nowSeconds: Math.floor(now / 1000),
        horizonSeconds,
      },
      now,
    )
    const commentsOf = new Map(files.map((file) => [file.address, file.comments]))
    for (const row of fileRows) {
      const comment = commentsOf.get(row.item.address)?.find((c) => c.id === row.commentId)
      if (comment) previews.set(row.item.id, { kind: 'file', address: row.item.address, comment })
    }

    // One list, newest screening event first: both halves carry the instant now.
    const rows: { item: ScreenerItem; at: number }[] = [...dmRows, ...fileRows]
    rows.sort((a, b) => b.at - a.at)
    return { items: rows.map((r) => r.item), previews }
  }, [effective, dms, now, files, frontier, membership.termsOf, membership.isMentioned, openWork.fileAddresses, openWork.dmIds])

  /*
    Publish the decisions the person owns, not the change that produced them.

    Driving this from the handlers would publish twice per change — once
    optimistically and once when the maps caught up — and would miss a decision
    made in another tab. `screenerToPublish` returns undefined for an unchanged
    pair, so a re-render costs nothing, and it caps before comparing so an
    eviction cannot loop.

    The guard is `effective` being undefined, which covers the relay's answer not
    having arrived. `useScreenerSync` checks `state === 'unknown'` again on its
    own side, because publishing an empty `dismissed` over a full one is
    last-write-wins and would bring back every row the person ever dismissed.

    Mock mode publishes nothing: there is no session and no relay, and a fixture
    is not the person's data.
  */
  const publish = sync.publish
  useEffect(() => {
    if (!hasRelay) return
    if (!effective || !settled) return
    void publish(effective)
  }, [effective, settled, publish])

  const dismiss = useCallback((rowId: string, nowMs: number) => {
    const key = keyOfRow(rowId)
    if (!key) return
    setPending((prev) => ({ ...prev, dismissed: { ...prev.dismissed, [key]: Math.floor(nowMs / 1000) } }))
  }, [])

  const snooze = useCallback((rowId: string, untilMs: number) => {
    const key = keyOfRow(rowId)
    if (!key) return
    setPending((prev) => ({ ...prev, snoozed: { ...prev.snoozed, [key]: Math.floor(untilMs / 1000) } }))
  }, [])

  const previewOf = useCallback((rowId: string) => previews.get(rowId), [previews])

  /*
    Desk's Urgent for files (CON-17). The member files read above, and the ones
    in open work, which that read skips because their rows hold the resolved
    file already: an urgent comment on a file in open work is still urgent.
  */
  const urgentFiles = useMemo<FoldedUrgentFile[]>(() => {
    if (!hasRelay || !frontier.ready || membership.state === 'unknown') return []
    const open: ScreenerFile[] = openWork.items.flatMap((item) =>
      item.kind === 'file' ? [{ address: item.address, kind: item.object.kind, title: item.title, comments: item.object.comments }] : [],
    )
    return foldUrgentFiles([...open, ...files], {
      merged: frontier.merged,
      termsOf: membership.termsOf,
      isMentioned: membership.isMentioned,
      isUrgent: membership.isUrgent,
      me: validToken()?.pubkey,
      nowSeconds: Math.floor(now / 1000),
      horizonSeconds: PEEK_HORIZON_DAYS * 24 * 60 * 60,
    })
  }, [files, openWork.items, frontier, now, membership.state, membership.termsOf, membership.isMentioned, membership.isUrgent])

  // Gated on the decisions alone. Both halves' rows are additive, so arriving
  // late costs a row a moment, where waiting on every channel and every followed
  // file would hold the whole Desk under a skeleton for the slowest read.
  const isLoading = hasRelay && effective === undefined

  const value = useMemo<ScreenerValue>(
    () => ({ items, isLoading, dismiss, snooze, previewOf, urgentFiles }),
    [items, isLoading, dismiss, snooze, previewOf, urgentFiles],
  )

  return <ScreenerContext.Provider value={value}>{children}</ScreenerContext.Provider>
}

/** Seam-internal. Components never call this. */
export function useScreener(): ScreenerValue {
  const ctx = useContext(ScreenerContext)
  if (!ctx) throw new Error('useScreener must be used within PeekDataProvider')
  return ctx
}
