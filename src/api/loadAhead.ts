/**
 * From Desk, Peek loads what you open next before you open it (PEE-5).
 *
 * Miky, 12 Oct: "when you first open Desk, then Topics should be fetched so
 * when you open it, it's there. Same thing maybe for DMs and Topics on Desk."
 * Decided at shaping, and the Screener added at PEE-4's kickoff: once Desk has
 * drawn, in this order —
 *
 * 1. Topics: the Folder listing, each Folder's files, and the Folders' streams;
 * 2. the {@link AHEAD_EACH} most recently active Open work topics;
 * 3. the {@link AHEAD_EACH} Starred people with the newest messages;
 * 4. the {@link AHEAD_EACH} newest Screener items;
 *
 * then nothing more until the next open of Peek.
 *
 * Each step reads what its click would read into the same caches — the Folder
 * listing and contents, the resolved file, the conversation store — so the
 * click draws from memory and asks only what changed since. The reads wait in
 * the socket pacer's `ahead` lane (`@estiva-app/platform`): only what a window
 * leaves over, never while a click waits, never over HTTP. A press of a key or
 * a pointer moves the ones still waiting into the click lane, since the caches
 * hand a click the read already out for the same thing. The first refused or
 * failed read stops the loader for good; what loaded stays.
 *
 * Loading ahead marks nothing read: the read marker is the open view's.
 *
 * `localStorage['peek.ahead'] = 'off'` turns it off, for the probe's comparison.
 */
import { useEffect, useRef } from 'react'
import { loadAhead, type AheadOutcome, type AheadStep } from '@estiva-app/platform'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'
import type { StoredToken } from '@/auth/estivaId'
import { getSocketReader, whenClickReadsQuiet } from '@/nostr/bridge'
import { RelayReadError } from '@/nostr/relayRead'
import { streamMessagesByFolder, type StreamMessage } from '@/nostr/channelStreams'
import type { ChannelStore } from '@/platform/channelStore'
import { placeStreams, teamHasMemberStream, unlistedFiles } from './teamUnread'
import { loadFileParentsAhead } from './useFileParents'
import { useRelayViewer } from './foreign'
import { useDeskItems, useScreenerItems } from './desk'
import { useStarred } from './internal/starred'
import { useDmChannels } from './internal/dms'
import { useMembership } from './internal/membership'
import { channelsAskedFor, trackAhead, useHeldChannelEvents, useTabChannelStoreForAhead } from './useChannelStreams'
import { loadFoldersAhead } from './useFolderContents'
import { loadForeignObjectAhead } from './useForeignConversation'
import { loadConversationAhead } from './useFileConversation'

/** How many of each group are loaded ahead (Miky, 12 Oct). */
export const AHEAD_EACH = 5

/** What the loader did this page load, for the first-load probe (`window.__loadAhead`). */
interface AheadRecord {
  startedAt: number
  steps: { label: string; ms: number }[]
  outcome?: { loaded: string[]; stoppedBy?: string }
}

/** Once per page load: "then stop until the next open". */
let started = false

/**
 * Topics' streams wait until no click read has been open for this long, at most
 * the second figure: tracking 50 Folders at the moment a click 1 s after Desk
 * was finishing made it ~500 ms slower (PEE-5).
 */
const CLICK_QUIET_MS = 1_000
const CLICK_QUIET_AT_MOST_MS = 5_000

/**
 * A step that failed for a passing reason — the socket paused after a quota
 * refusal, a REQ never ended, the connection dropped, the relay's own load — is
 * run again a window later, at most this many times; what it had already read
 * is held, so only the rest is asked. Stopping on the first such failure left
 * Topics unloaded for a whole page load (QA-1, 16 s to open).
 */
const AHEAD_RETRIES = 2
const AHEAD_RETRY_MS = 6_000
const PASSING = /socket paused|not live|no EOSE|rate-limited|quota exceeded|reconnecting|connecting|too many concurrent|database error/i

function passing(error: unknown): boolean {
  if (error instanceof RelayReadError && (error.kind === 'rate_limited' || error.kind === 'unreachable')) return true
  return PASSING.test(String(error))
}

/** `localStorage['peek.ahead'] = 'off'` turns it off, for the probe's comparison (a URL's query does not survive sign-in). */
const aheadOff = (() => {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('peek.ahead') === 'off'
  } catch {
    return false
  }
})()

/** The newest `created_at` among `events` each key matches, by key. */
function newestBy(events: readonly SignedEvent[], keyOf: (event: SignedEvent) => string[]): Map<string, number> {
  const newest = new Map<string, number>()
  for (const event of events) {
    for (const key of keyOf(event)) newest.set(key, Math.max(newest.get(key) ?? 0, event.created_at))
  }
  return newest
}

/** The most recent first, by `at`; equal ones keep their order. */
function mostRecent<T>(items: readonly T[], at: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, at: at(item) }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .slice(0, AHEAD_EACH)
    .map(({ item }) => item)
}

/** The conversation a file's page draws in Peek's own view, or null for one it shows read-only (`useFileView`). */
function containerOf(file: ForeignObject | null) {
  const canComment = !!file?.naddr && (file.actions ?? []).some((action) => action.id === 'comment')
  return canComment && file?.address && file.folder ? { kind: 'file' as const, address: file.address, h: file.folder } : null
}

/**
 * The Folders Topics opens by default, the person's own, by `useTeamUnread`'s
 * rule: a Folder whose streams hold talk in a file they are a member of, or
 * whose state lists such a file or the parent of a joined file no state lists
 * (an issue, under its project), and every Folder that lists one of those.
 * The parents are read on the `ahead` lane into Topics' own cache.
 */
async function foldersTopicsOpens(
  folders: readonly FolderSummary[],
  store: ChannelStore,
  membership: { isMember: (address: string) => boolean; memberFiles: readonly string[] },
  at: { relayUrl: string; token: StoredToken },
): Promise<FolderSummary[]> {
  const held: Record<string, StreamMessage[]> = {}
  for (const folder of folders) {
    const events = store.events(folder.id)
    if (events) held[folder.id] = streamMessagesByFolder(events, [folder.id], at.token.pubkey)[folder.id] ?? []
  }
  const listed = new Set(folders.flatMap((folder) => (folder.hasState ? (folder.addresses ?? []) : [])))
  const joinedUnlisted = membership.memberFiles.filter((address) => !listed.has(address))
  const parents = Object.fromEntries(await loadFileParentsAhead([...unlistedFiles(held, folders), ...joinedUnlisted], at))
  const placed = placeStreams(held, folders, parents)
  const holdsJoined = new Set(joinedUnlisted.map((address) => parents[address]).filter((parent): parent is string => !!parent))
  const mine = new Set<string>()
  for (const folder of folders) {
    if (teamHasMemberStream(placed.streams[folder.id] ?? [], membership.isMember)) mine.add(folder.id)
    if (folder.hasState && folder.addresses?.some((address) => holdsJoined.has(address) || membership.isMember(address))) mine.add(folder.id)
  }
  for (const folder of folders) if (mine.has(folder.id)) for (const container of folder.listedIn ?? []) mine.add(container)
  return folders.filter((folder) => mine.has(folder.id))
}

/**
 * Start loading ahead once Desk has drawn (`drawn`), the first time on this
 * page load. Desk's lists as they are at that moment decide what is loaded.
 */
export function useLoadAhead(drawn: boolean): void {
  const viewer = useRelayViewer()
  const { openWork } = useDeskItems()
  const { entries: starred } = useStarred()
  const screener = useScreenerItems()
  const { channelOf } = useDmChannels()
  const held = useHeldChannelEvents()
  const store = useTabChannelStoreForAhead()
  const membership = useMembership()

  // Desk's lists are read when Desk has drawn, not on every change after it; a DM's channel when its step runs.
  const latest = useRef({ openWork, starred, screener, channelOf, held, store, membership })
  useEffect(() => {
    latest.current = { openWork, starred, screener, channelOf, held, store, membership }
  })

  useEffect(() => {
    if (!drawn || started || aheadOff) return
    const at = viewer()
    const { openWork, starred, screener, held, store } = latest.current
    if (!at || !store) return
    started = true
    const channelOf = (dmId: string) => latest.current.channelOf(dmId)

    const conversationOf = async (address: string) => {
      const file = await loadForeignObjectAhead(address, at)
      const container = containerOf(file)
      if (container) await loadConversationAhead(container, (file?.comments ?? []).map((comment) => comment.id), at)
    }
    const dmOf = async (dmId: string) => {
      const h = channelOf(dmId)
      if (h) await loadConversationAhead({ kind: 'channel', h }, [], at)
    }

    const byFile = newestBy(held, (event) =>
      event.tags.filter((tag) => (tag[0] === 'A' || tag[0] === 'a') && tag[1]).map((tag) => tag[1]),
    )
    const byChannel = newestBy(held, (event) => (event.kind === 9 ? event.tags.filter((tag) => tag[0] === 'h').map((tag) => tag[1]) : []))
    const topics = mostRecent(
      openWork.flatMap((item) => (item.kind === 'file' ? [item] : [])),
      (item) => byFile.get(item.address) ?? 0,
    )
    const people = mostRecent(starred, (entry) => byChannel.get(channelOf(entry.dmId) ?? '') ?? 0)

    let releaseFolders: (() => void) | null = null
    const steps: AheadStep[] = [
      {
        label: 'Topics',
        run: async () => {
          const began = performance.now()
          let opened = 0
          const lap = (label: string) => record.steps.push({ label: `Topics: ${label}`, ms: Math.round(performance.now() - began) })
          const folders = await loadFoldersAhead(at, async (folders) => {
            lap('listing')
            const cut = (() => { try { return window.localStorage.getItem('peek.ahead.topics') } catch { return null } })()
            if (cut === 'listing') return []
            // Tracking opens the Folders' live watches, whose frames share the window: a click under way finishes first.
            await whenClickReadsQuiet(CLICK_QUIET_MS, CLICK_QUIET_AT_MOST_MS)
            lap('quiet')
            // The streams Topics judges its dots and its "yours" by; held five minutes after the loader lets go.
            releaseFolders = trackAhead(store, folders.map((folder) => folder.id))
            await store.sync('track')
            lap('streams')
            if (cut === 'track') return []
            const mine = await foldersTopicsOpens(folders, store, latest.current.membership, at)
            lap('parents')
            opened = mine.length
            return mine
          })
          record.steps.push({ label: `Topics: ${folders.length} Folders, ${opened} opened`, ms: Math.round(performance.now() - began) })
        },
      },
      ...topics.map((item) => ({ label: `Open work: ${item.title}`, run: () => conversationOf(item.address) })),
      ...people.map((entry) => ({ label: `Starred: ${entry.name}`, run: () => dmOf(entry.dmId) })),
      ...screener.slice(0, AHEAD_EACH).map((item) =>
        item.kind === 'file'
          ? { label: `Screener: ${item.title}`, run: () => conversationOf(item.address) }
          : { label: `Screener: ${item.authorName}`, run: () => dmOf(item.dmId) },
      ),
    ]

    const only = (() => { try { return window.localStorage.getItem('peek.ahead.only') } catch { return null } })()
    if (only) steps.splice(0, steps.length, ...steps.filter((step) => step.label.startsWith(only)))
    const record: AheadRecord = { startedAt: performance.now(), steps: [] }
    ;(window as unknown as { __loadAhead?: AheadRecord }).__loadAhead = record
    const timed = steps.map((step) => ({
      label: step.label,
      run: async () => {
        const began = performance.now()
        for (let attempt = 1; ; attempt++) {
          try {
            await step.run()
            break
          } catch (error) {
            if (attempt > AHEAD_RETRIES || !passing(error)) throw error
            record.steps.push({ label: `${step.label}: again after ${String(error).slice(0, 80)}`, ms: Math.round(performance.now() - began) })
            await new Promise((resolve) => setTimeout(resolve, AHEAD_RETRY_MS))
          }
        }
        record.steps.push({ label: step.label, ms: Math.round(performance.now() - began) })
      },
    }))

    // A click goes first, including a click on what the loader has already asked for.
    const promote = () => {
      getSocketReader()?.promoteAhead?.()
      channelsAskedFor()
    }
    // @estiva-escape(no-rebuilt-behaviour): not a UI behaviour — any press means a click's reads may be on the way, so the loader's waiting reads stop holding them up; nothing is closed or taken
    window.addEventListener('pointerdown', promote, true)
    // @estiva-escape(no-rebuilt-behaviour): as above, for a key that opens something; the key goes on to its target untouched
    window.addEventListener('keydown', promote, true)

    void loadAhead(timed).done.then((outcome: AheadOutcome) => {
      window.removeEventListener('pointerdown', promote, true)
      window.removeEventListener('keydown', promote, true)
      ;(releaseFolders as (() => void) | null)?.()
      const stoppedBy = outcome.stoppedBy === 'stopped' ? 'stopped' : outcome.stoppedBy ? `${outcome.stoppedBy.label}: ${String(outcome.stoppedBy.error)}` : undefined
      record.outcome = { loaded: outcome.loaded, stoppedBy }
      if (stoppedBy) console.warn('[loadAhead] stopped:', stoppedBy)
    })
  }, [drawn, viewer])
}
