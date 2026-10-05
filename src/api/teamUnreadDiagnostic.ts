import type { FolderSummary } from '@estiva-app/interop'
import type { StreamMessage } from '@/nostr/channelStreams'
import { channelContext, fileContext } from '@estiva-app/conversation'
import type { RelayFailureKind } from '@/nostr/relayRead'
import type { MembershipState } from '@/nostr/useMembershipSync'
import { type StreamTerms, streamHasUnread } from './streamUnread'
import { streamsOf } from './teamUnread'

/**
 * Why `useTeamUnread` re-read. The one that matters is `socket`: the wide
 * filter said something was said and the settle fired.
 */
export type TeamUnreadTrigger = 'folders' | 'socket' | 'relay-live' | 'refresh'

/** One re-read: when, what asked for it, and what came back. */
export interface TeamUnreadLoad {
  trigger: TeamUnreadTrigger
  at: string
  outcome: 'pending' | 'ok' | 'failed'
  /** How long the read took, once it has finished. */
  ms?: number
  /** Folders the read answered for — not the ones asked about. */
  answered?: number
  failure?: RelayFailureKind
}

/** One stream inside a Folder, and why it does or does not light. */
export interface TeamUnreadStream {
  /** The file's address, or the Folder's id for the general chat. */
  key: string
  /** Whether the person is a member of it (SPEC §11.8). A stream they are not a member of lights only for a message that names them. */
  member: boolean
  /** Whether they muted it. */
  muted: boolean
  /** Its read-state context, or absent for a key that names no stream. */
  context?: string
  /** The merged marker for that context, ISO, or null for none. */
  marker: string | null
  messages: number
  newest?: { at: string; by: string; mine: boolean }
  /** This stream's own verdict — the judge, over this stream only. */
  unread: boolean
}

/** Why one Folder's dot is, or is not, lit. */
export interface TeamUnreadFolder {
  id: string
  /** Whether it is one of the Folders this mount asked about. */
  listed: boolean
  /** Whether the last read answered for it at all. `false` means it was not judged. */
  read: boolean
  messages: number
  streams: TeamUnreadStream[]
  /** The hook's own answer. `undefined` means no dot is drawn either way. */
  unread?: boolean
  member?: boolean
  /** The containers it folds into (FOL-22), and whether each is lit. */
  listedIn: { container: string; unread?: boolean }[]
}

/** What one mounted `useTeamUnread` can say about itself. */
export interface TeamUnreadSnapshot {
  folders: number
  live: boolean
  relayState: string
  /** Wide-filter signals delivered to *this hook* — `__wideFilters()` counts the socket's side. */
  deliveries: number
  lastDelivery?: { folder: string; at: string; listed: boolean }
  loads: number
  lastLoad?: TeamUnreadLoad
  /** The two gates that return an empty map before anything is judged. */
  frontierReady: boolean
  membership: MembershipState
  /** Folders the last read answered for, and when it was taken. */
  held: number
  heldAt: string | null
  /** Folders currently lit, capped — the dots as drawn. */
  lit: string[]
  /** The named Folder, or the last one the socket delivered. */
  folder?: TeamUnreadFolder
}

/** Everything the snapshot reads, handed over after each render. */
export interface TeamUnreadObservation {
  ids: readonly string[]
  folders: readonly FolderSummary[]
  live: boolean
  relayState: string
  frontierReady: boolean
  marker: (context: string | undefined) => number | undefined
  merged: Readonly<Record<string, number>>
  membership: MembershipState
  termsOf: (key: string) => StreamTerms
  isMentioned: (messageId: string) => boolean
  me: string | undefined
  held: { at: number; streams: Record<string, StreamMessage[]> }
  horizonSeconds: number
  result: { unread: Record<string, boolean>; member: Record<string, boolean> }
}

/** What the hook writes to. Every method is safe to call before the first observation. */
export interface TeamUnreadProbe {
  delivered: (folder: string) => void
  loadStarted: (trigger: TeamUnreadTrigger) => void
  loadSettled: (outcome: 'ok' | 'failed', detail: { answered?: number; failure?: RelayFailureKind }) => void
  observe: (observation: TeamUnreadObservation) => void
  stop: () => void
}

const LIT_CAP = 10

const probes = new Set<{ snapshot: (folder?: string) => TeamUnreadSnapshot }>()

const iso = (unixSeconds: number) => new Date(unixSeconds * 1_000).toISOString()

/**
 * A mounted `useTeamUnread`, readable from the console.
 *
 * `__wideFilters()` (FOL-40, peek#296) ends at the socket: it proves a Folder's
 * event was delivered. It proved exactly that, on production, with the dot
 * still dark — so the question moved to the four things standing between the
 * delivery and the dot, none of which leaves a trace: the settle firing, the
 * re-read it triggers, the two gates that return an empty map (`frontier.ready`
 * and an unknown follows set), and the judge, which draws nothing for a stream
 * the person does not follow.
 *
 * Each of those is a `continue` or an early return over a value that lives for
 * one render. This keeps the last of each, per mount — the sidebar's tree and
 * the Folders page each hold one — and hands them over on request.
 */
export function teamUnreadProbe(): TeamUnreadProbe {
  let deliveries = 0
  let lastDelivery: TeamUnreadSnapshot['lastDelivery']
  let loads = 0
  let lastLoad: TeamUnreadLoad | undefined
  let startedAt = 0
  let seen: TeamUnreadObservation | undefined

  const entry = {
    snapshot: (folder?: string): TeamUnreadSnapshot => {
      const base = {
        folders: seen?.ids.length ?? 0,
        live: seen?.live ?? false,
        relayState: seen?.relayState ?? 'unknown',
        deliveries,
        ...(lastDelivery ? { lastDelivery } : {}),
        loads,
        ...(lastLoad ? { lastLoad } : {}),
        frontierReady: seen?.frontierReady ?? false,
        membership: seen?.membership ?? ('unknown' as MembershipState),
        held: seen ? Object.keys(seen.held.streams).length : 0,
        heldAt: seen?.held.at ? iso(seen.held.at) : null,
        lit: seen ? litIn(seen).slice(0, LIT_CAP) : [],
      }
      // No argument asks about the Folder the socket last named, which is the
      // one somebody at a console is asking about.
      const asked = folder ?? lastDelivery?.folder
      return asked && seen ? { ...base, folder: explain(asked, seen) } : base
    },
  }
  probes.add(entry)

  return {
    delivered: (folder: string) => {
      deliveries += 1
      lastDelivery = {
        folder,
        at: new Date().toISOString(),
        listed: seen?.ids.includes(folder) ?? false,
      }
    },
    loadStarted: (trigger: TeamUnreadTrigger) => {
      loads += 1
      startedAt = Date.now()
      lastLoad = { trigger, at: new Date().toISOString(), outcome: 'pending' }
    },
    loadSettled: (outcome, detail) => {
      if (!lastLoad) return
      lastLoad = { ...lastLoad, outcome, ms: Date.now() - startedAt, ...detail }
    },
    observe: (observation: TeamUnreadObservation) => {
      seen = observation
    },
    stop: () => probes.delete(entry),
  }
}

function litIn(seen: TeamUnreadObservation): string[] {
  return Object.keys(seen.result.unread).filter((id) => seen.result.unread[id])
}

/** The gates, for one Folder, in the order the hook applies them. */
function explain(id: string, seen: TeamUnreadObservation): TeamUnreadFolder {
  const messages = seen.held.streams[id]
  const summary = seen.folders.find((folder) => folder.id === id)
  const report: TeamUnreadFolder = {
    id,
    listed: seen.ids.includes(id),
    read: messages !== undefined,
    messages: messages?.length ?? 0,
    streams: [],
    unread: seen.result.unread[id],
    member: seen.result.member[id],
    listedIn: (summary?.listedIn ?? []).map((container) => ({
      container,
      unread: seen.result.unread[container],
    })),
  }
  if (!messages) return report
  for (const [key, stream] of streamsOf(id, messages)) {
    const context = key === id ? channelContext(id) : fileContext(key)
    const marker = seen.marker(context)
    const terms = seen.termsOf(key)
    const newest = stream.reduce((latest, message) => (message.at > latest.at ? message : latest))
    report.streams.push({
      key,
      member: terms.member,
      muted: terms.muted,
      ...(context === undefined ? {} : { context }),
      marker: marker === undefined ? null : iso(marker),
      messages: stream.length,
      newest: { at: iso(newest.at), by: newest.by.slice(0, 8), mine: newest.by === seen.me },
      // The same call the judge makes, on the same stream — not a second rule.
      // The judge skips the general stream (no screen for it, §11.8), so it is never unread here.
      unread:
        key !== id &&
        context !== undefined &&
        streamHasUnread(
          stream,
          context,
          terms,
          { merged: seen.merged, me: seen.me, nowSeconds: seen.held.at, horizonSeconds: seen.horizonSeconds },
          seen.isMentioned,
        ),
    })
  }
  return report
}

/**
 * `window.__teamUnread(folder?)` — one entry per mounted hook. Installed at
 * module scope from the api barrel, as `__membership` and `__wideFilters` are,
 * and not gated on a build flag for the same reason: a diagnostic absent from
 * production is never there when it is needed.
 */
export function installTeamUnreadDiagnostic(): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>).__teamUnread = (folder?: string) =>
    [...probes].map((probe) => probe.snapshot(folder))
}
