/**
 * The Screener — the topic half folded here, the decisions on the relay (SHR-10).
 *
 * `screenerItems` had seven fields and five of them were derived. This file is
 * where those five are computed instead: `kind` and `targetId` from the
 * container a message is in, `preview` from the message, `messageId` and
 * `createdAt` from the same message. The two that were authored — a snooze and
 * a dismissal — are the person's, so they live in their own
 * `estiva-peek:screener:v1` blob and nowhere else.
 *
 * ## The rules, and where each input comes from
 *
 * §2.12's rules, applied here rather than on write for every user in the
 * workspace. `convex/screener.ts`'s `candidates` supplies facts about the
 * viewer's own containers; this file decides which of them screen:
 *
 * | Rule | Decided by |
 * |---|---|
 * | 2 — added to a topic, never opened, it got a message | `isMember && !everOpened` and any event |
 * | 3 — you were `@mentioned` | `event.mentionsMe`, whether or not you are a member |
 * | refresh — you participated in the thread | `event.isReply && event.iWroteInThread` |
 * | urgent never screens | dropped in `candidates`; it is Desk Urgent's (§4.4) |
 * | 1 — someone DMs you | **not here.** Convex, until DMS-3 — see below |
 * | a followed file got a comment you have not read (FOL-34) | `foldFileScreenerRows`, from the relay |
 *
 * The file row is relay-only end to end: a file's `kind:1111` conversation
 * never enters Convex, so `candidates` cannot hold it, and nothing was added to
 * Convex to make it (ADR 0001 — the conversation is the relay's, and the rule
 * is the unread dot's, which is already computed here from the read frontier).
 * One row per conversation, carrying the newest screening event's preview,
 * which is what `upsert` meant by "refreshed, never duplicated".
 *
 * ## The two halves, and the seam between them
 *
 * Rule 1 has no relay stream and no client-side message stream to fold from:
 * `dmConversations` has no channel uuid (`convex/nostr/sync.ts:527`, DMS-3). So
 * DMs stay on `desk.screenerList` and are merged in here, ordered together with
 * the folded topic rows. The seam is `kind`, which both sides already carry.
 * When DMS-3 lands a DM *is* a channel and this file folds both.
 *
 * ## PEE-6, which is now what SHR-7 said it would be
 *
 * "An item in Desk Open Work must not screen." Server-side that was two indexed
 * reads and a `Set` of `` `${kind}:${targetId}` ``. Here it is the same `Set`
 * intersection over two in-memory arrays, against the open-work **list** rather
 * than its rendered rows — a topic the workspace index has not delivered yet is
 * still in open work, and screening it because its title has not arrived is the
 * duplicate PEE-6 exists to stop. `useOpenWork().topicIds` is that list's topic
 * ids and is already read off the list for exactly this reason, so this is one
 * `Set.has` per container and no second spelling of a key to keep in step.
 *
 * The DM half keeps its server-side de-duplication, which still works because
 * SHR-9 deliberately kept `deskOpenWork` dual-written.
 *
 * ## `clearScreenerFor` is gone for topics, and nothing replaced it
 *
 * Opening a conversation used to delete its screener row (`readState.ts:59`).
 * Under the fold there is nothing to delete: rule 2 holds only while
 * `everOpened` is false, so opening a topic retires its row on the next read,
 * with no write at all. That is the free thing SHR-7 §5 predicted.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { SCREENER_ITEMS } from '@/data/screenerData'
import { hasConvex } from '@/api/store'
import { useAvatarSrc } from '@/api/avatars'
import { useTopics } from '@/api/topics'
import { useOpenWork } from '@/api/internal/openWork'
import { useFollows } from '@/api/internal/follows'
import { useForeignObjects } from '@/api/foreign'
import { validToken } from '@/auth/estivaId'
import { useScreenerSync } from '@/nostr/useScreenerSync'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { fileContext, PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { screenerKey, type InstantMap } from '@/nostr/screener'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { foldFileScreenerRows, foldScreenerRows, type ScreenerFile } from '@/api/internal/screenerFold'
import type { ScreenerItem } from '@/api/types'
import { RELAY_URL } from '@/api/relayUrl'

export interface ScreenerValue {
  /** The rows, newest screening event first. */
  items: ScreenerItem[]
  /** True until every source has settled. Drives the Desk skeleton. */
  isLoading: boolean
  /** Dismiss a folded topic row: a watermark at `now`, not a deletion. */
  dismissTopic: (topicId: string, nowMs: number) => void
  /** "Later" on a folded topic row. */
  snoozeTopic: (topicId: string, untilMs: number) => void
  /** Dismiss a followed file's row (FOL-34) — a watermark, as for a topic. */
  dismissFile: (address: string, nowMs: number) => void
  /** "Later" on a followed file's row. */
  snoozeFile: (address: string, untilMs: number) => void
}

/**
 * How often the file half re-reads while the Desk is visible (FOL-34).
 *
 * Slower than `REFRESH_INTERVAL_MS` because it was one relay request per
 * followed file, against a quota of 300 a minute per person that every open
 * tab shares. Since PER-10 the whole set is one request, so this could come
 * down; it has not, because nothing asked for fresher file rows. Focus and
 * visibility still re-read at once, which is the moment somebody actually looks.
 */
const FILE_REFRESH_MS = 60_000

/**
 * The followed files the Screener judges, read from the relay (FOL-34).
 *
 * A file's conversation never enters Convex, so this half has no server-side
 * candidates to fold: it asks the relay for the followed files directly — every
 * file's title and top-level comments in one read (PER-10) — and
 * `foldFileScreenerRows` decides which of them screen. `[]` until asked: a
 * missing file row is the quiet failure, and a Desk held under a skeleton for a
 * relay that is down is the loud one.
 */
function useFollowedFiles(addresses: readonly string[]): ScreenerFile[] {
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
      if (!hasConvex || asked.length === 0) return
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
    read(key ? key.split('\u0000').filter((address) => !(address in heldRef.current)) : [])
  }, [key, read])
  // A refresh re-reads everything in the set — that is how new comments arrive.
  useRefreshTriggers(() => read(key ? key.split('\u0000') : []), {
    enabled: hasConvex && !!key,
    intervalMs: FILE_REFRESH_MS,
  })

  return useMemo(
    () => addresses.flatMap((address) => (held[address] ? [held[address]] : [])),
    [addresses, held],
  )
}

const ScreenerContext = createContext<ScreenerValue | null>(null)

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

  const candidates = useQuery(api.screener.candidates, hasConvex ? {} : 'skip')
  const dmRows = useQuery(api.desk.screenerList, hasConvex ? {} : 'skip')
  // Read once, for the `absent` seed only. A person whose snoozes predate this
  // ticket keeps them; nothing reads it after the first publish. Dismissals
  // cannot be seeded — see `desk.topicSnoozes`.
  const legacySnoozes = useQuery(api.desk.topicSnoozes, hasConvex ? {} : 'skip')

  const openWork = useOpenWork()
  const topics = useTopics()
  const avatarSrcFor = useAvatarSrc()

  /** The decisions as last settled, before this session's changes. */
  const settled = useMemo<Pending | undefined>(() => {
    if (sync.state === 'present' && sync.relayBlob) {
      return { snoozed: sync.relayBlob.snoozed, dismissed: sync.relayBlob.dismissed }
    }
    if (sync.state === 'absent') {
      if (legacySnoozes === undefined) return undefined
      const snoozed: InstantMap = {}
      for (const row of legacySnoozes) snoozed[screenerKey('topic', row.topicId)] = Math.floor(row.snoozedUntil / 1000)
      return { snoozed, dismissed: {} }
    }
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
  }, [sync.state, sync.relayBlob, sync.asked, legacySnoozes])

  const effective = useMemo<Pending | undefined>(() => {
    if (!settled) return undefined
    // A decision made this session always wins over the settled one: both maps
    // only ever move forward, and the later instant is the one the person just
    // chose. `Math.max` rather than an overwrite so a stale settled value that
    // arrives after the click cannot undo it.
    const merge = (base: InstantMap, over: InstantMap): InstantMap => {
      const out: InstantMap = { ...base }
      for (const [key, value] of Object.entries(over)) out[key] = Math.max(out[key] ?? 0, value)
      return out
    }
    return { snoozed: merge(settled.snoozed, pending.snoozed), dismissed: merge(settled.dismissed, pending.dismissed) }
  }, [settled, pending])

  const topicById = useMemo(() => new Map((topics ?? []).map((t) => [t.id, t])), [topics])

  /** PEE-6, on the list rather than the rendered rows — see the header. */
  const openWorkKeys = useMemo(() => openWork.topicIds, [openWork.topicIds])

  /*
    The file half (FOL-34). Followed keys are file addresses and Folder uuids;
    only an address has a file context. A file already in open work is not
    asked about at all — PEE-6 would drop its row anyway, and the read is the
    expensive part. Nothing is judged before the relay has said what is
    followed, for the reason `useConversationBadges` gives.
  */
  const follows = useFollows()
  const frontier = useReadFrontier()
  const followedFiles = useMemo(
    () =>
      follows.state === 'unknown'
        ? []
        : [...follows.followed]
            .filter((key) => fileContext(key) !== undefined && !openWork.fileAddresses.has(key))
            .sort(),
    [follows.state, follows.followed, openWork.fileAddresses],
  )
  const files = useFollowedFiles(followedFiles)

  const items = useMemo<ScreenerItem[]>(() => {
    if (!hasConvex) return SCREENER_ITEMS
    if (!candidates || !effective) return []

    const rows = foldScreenerRows(
      candidates.containers,
      effective,
      openWorkKeys,
      (topicId) => topicById.get(topicId)?.title,
      now,
    )

    // Not judged until the read-state merge has landed: before it every marker
    // is absent, and absent reads as "new" for every followed file at once.
    const fileRows = frontier.ready
      ? foldFileScreenerRows(
          files,
          effective,
          openWork.fileAddresses,
          {
            marker: (address) => frontier.marker(fileContext(address)),
            me: validToken()?.pubkey,
            nowSeconds: Math.floor(now / 1000),
            horizonSeconds: PEEK_HORIZON_DAYS * 24 * 60 * 60,
          },
          now,
        )
      : []

    // The DM half, merged rather than folded. `screenerList` already sorts
    // `createdAt` descending and applies its own snooze and PEE-6 check, but it
    // does not return the instant — so DMs keep their relative order and sit
    // above the folded rows, which is where the newest traffic usually is.
    const dms: ScreenerItem[] = (dmRows ?? []).map((row) =>
      row.kind === 'dm' ? { ...row, authorAvatarSrc: avatarSrcFor(row.authorName) } : row,
    )

    // Topics and files are both folded with their instant, so they interleave
    // by it; `at` is seconds for a file and the Convex ms for a topic.
    const folded = [
      ...rows.map((r) => ({ at: r.at, item: r.item as ScreenerItem })),
      ...fileRows.map((r) => ({ at: r.at * 1000, item: r.item as ScreenerItem })),
    ].sort((a, b) => b.at - a.at)

    return [...dms, ...folded.map((r) => r.item)]
  }, [candidates, effective, openWorkKeys, topicById, dmRows, avatarSrcFor, now, files, frontier, openWork.fileAddresses])

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
    if (!hasConvex) return
    if (!effective) return
    void publish(effective)
  }, [effective, publish])

  const dismissTopic = useCallback((topicId: string, nowMs: number) => {
    const key = screenerKey('topic', topicId)
    setPending((prev) => ({ ...prev, dismissed: { ...prev.dismissed, [key]: Math.floor(nowMs / 1000) } }))
  }, [])

  const snoozeTopic = useCallback((topicId: string, untilMs: number) => {
    const key = screenerKey('topic', topicId)
    setPending((prev) => ({ ...prev, snoozed: { ...prev.snoozed, [key]: Math.floor(untilMs / 1000) } }))
  }, [])

  const dismissFile = useCallback((address: string, nowMs: number) => {
    const key = screenerKey('file', address)
    setPending((prev) => ({ ...prev, dismissed: { ...prev.dismissed, [key]: Math.floor(nowMs / 1000) } }))
  }, [])

  const snoozeFile = useCallback((address: string, untilMs: number) => {
    const key = screenerKey('file', address)
    setPending((prev) => ({ ...prev, snoozed: { ...prev.snoozed, [key]: Math.floor(untilMs / 1000) } }))
  }, [])

  // Not gated on `topics`: it settles only for a signed-in viewer, and hanging
  // on it would leave the Desk under a skeleton for anyone it never settles for.
  // Nor on the file half: its rows are additive, so arriving late costs a row a
  // moment, where waiting on a relay read per followed file would cost the Desk.
  const isLoading = hasConvex && (candidates === undefined || dmRows === undefined || effective === undefined)

  const value = useMemo<ScreenerValue>(
    () => ({ items, isLoading, dismissTopic, snoozeTopic, dismissFile, snoozeFile }),
    [items, isLoading, dismissTopic, snoozeTopic, dismissFile, snoozeFile],
  )

  return <ScreenerContext.Provider value={value}>{children}</ScreenerContext.Provider>
}

/** Seam-internal. Components never call this. */
export function useScreener(): ScreenerValue {
  const ctx = useContext(ScreenerContext)
  if (!ctx) throw new Error('useScreener must be used within PeekDataProvider')
  return ctx
}

export { fileAddressFromScreenerRowId, topicIdFromScreenerRowId } from '@/api/internal/screenerFold'
