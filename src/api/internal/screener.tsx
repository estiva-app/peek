/**
 * The Screener — the file half folded here, the DM half from Convex, the
 * decisions on the relay (SHR-10, FOL-34).
 *
 * A snooze and a dismissal are the person's, so they live in their own
 * `estiva-peek:screener:v1` blob and nowhere else.
 *
 * ## The rules, and where each input comes from
 *
 * | Rule | Decided by |
 * |---|---|
 * | 1 — someone DMs you | **not here.** `desk.screenerList`, merged in — see below |
 * | a followed file got a comment you have not read (FOL-34) | `foldFileScreenerRows`, from the relay |
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
 * ## The two halves, and the seam between them
 *
 * DMs stay on `desk.screenerList` and are merged in here, above the folded
 * file rows. The seam is `kind`, which both sides already carry. The DM half
 * keeps its server-side PEE-6 de-duplication ("an item in Desk Open Work must
 * not screen") against `deskOpenWork`, which nothing has written since REM-4,
 * so it hides only DMs that were in open work then; "Open" on a DM row deletes
 * the row instead (`addScreenerToOpenWork`) until CON-14 folds this half from
 * the relay too. The file half checks the open-work **list**, not its rows.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { SCREENER_ITEMS } from '@/data/screenerData'
import { hasConvex } from '@/api/store'
import { useAvatarSrc } from '@/api/avatars'
import { useOpenWork } from '@/api/internal/openWork'
import { useFollows } from '@/api/internal/follows'
import { useForeignObjects } from '@/api/foreign'
import { validToken } from '@/auth/estivaId'
import { useScreenerSync } from '@/nostr/useScreenerSync'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { fileContext, PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { screenerKey, type InstantMap } from '@/nostr/screener'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { foldFileScreenerRows, type ScreenerFile } from '@/api/internal/screenerFold'
import type { ScreenerItem } from '@/api/types'
import { RELAY_URL } from '@/api/relayUrl'

export interface ScreenerValue {
  /** The rows, newest screening event first. */
  items: ScreenerItem[]
  /** True until every source has settled. Drives the Desk skeleton. */
  isLoading: boolean
  /** Dismiss a followed file's row (FOL-34) — a watermark at `now`, not a deletion. */
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

  const dmRows = useQuery(api.desk.screenerList, hasConvex ? {} : 'skip')

  const openWork = useOpenWork()
  const avatarSrcFor = useAvatarSrc()

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
    if (!effective) return []

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
    const dms: ScreenerItem[] = (dmRows ?? []).map((row) => ({ ...row, authorAvatarSrc: avatarSrcFor(row.authorName) }))

    return [...dms, ...fileRows.map((r) => r.item)]
  }, [effective, dmRows, avatarSrcFor, now, files, frontier, openWork.fileAddresses])

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

  const dismissFile = useCallback((address: string, nowMs: number) => {
    const key = screenerKey('file', address)
    setPending((prev) => ({ ...prev, dismissed: { ...prev.dismissed, [key]: Math.floor(nowMs / 1000) } }))
  }, [])

  const snoozeFile = useCallback((address: string, untilMs: number) => {
    const key = screenerKey('file', address)
    setPending((prev) => ({ ...prev, snoozed: { ...prev.snoozed, [key]: Math.floor(untilMs / 1000) } }))
  }, [])

  // Not gated on the file half: its rows are additive, so arriving late costs a
  // row a moment, where waiting on a relay read per followed file would cost the
  // Desk.
  const isLoading = hasConvex && (dmRows === undefined || effective === undefined)

  const value = useMemo<ScreenerValue>(
    () => ({ items, isLoading, dismissFile, snoozeFile }),
    [items, isLoading, dismissFile, snoozeFile],
  )

  return <ScreenerContext.Provider value={value}>{children}</ScreenerContext.Provider>
}

/** Seam-internal. Components never call this. */
export function useScreener(): ScreenerValue {
  const ctx = useContext(ScreenerContext)
  if (!ctx) throw new Error('useScreener must be used within PeekDataProvider')
  return ctx
}

export { fileAddressFromScreenerRowId } from '@/api/internal/screenerFold'
