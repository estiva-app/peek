/**
 * The reactions to your messages (ACT-7; SPEC §6.6 *Finding the reactions to a person*): one source per tab, which every
 * row, card and page list reads from, so a 👍 from Katerina is found once however many places draw it.
 *
 * What it asks the relay, and nothing else:
 *
 * - **one stored read**, `{kinds:[7], "#p":[you], since}` (`reactionsToMeFilter`), the newest
 *   {@link REACTIONS_TO_ME_READ} only, asked again when the tab comes back into focus or view;
 * - **one read of the messages they react to** that the tab does not hold, by `{ids}`, all of them in one filter;
 * - the relay's signing key (`relaySigningKeyOnce`), only when a reaction or a message could be signed by the relay on
 *   somebody's behalf (`needsRelayKey`);
 * - **two requests kept open** on the tab's socket: the same `#p` filter from now on — by `#p` alone where the relay
 *   says a kept-open request hears what asking again would return (`buzz-live-as-stored`), else naming the teams by
 *   `#h` — and `{kinds:[5], "#e":[…]}` over the reactions drawn and the messages they react to, so a reaction taken
 *   back, or a message deleted later, goes. Never through the platform's Folder watch, which drops what carries no `h`.
 *
 * Which of them are reactions to you is the shared rule's (`reactionsToMe`): the last `p` is you, you wrote the
 * message, you did not react yourself. A reaction on a message the tab could not read keeps nothing.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reaction-names-whose-message-it-reacts-to.md
 */
import { useEffect, useSyncExternalStore } from 'react'
import { relayNamesTeams } from '@estiva-app/interop'
import { needsRelayKey, type SignedEvent } from '@estiva-app/protocol'
import {
  reactionStreamOf,
  reactionTargetOf,
  reactionsToMe,
  reactionsToMeFilter,
  reactionTakeBackFilter,
  type ReactionToMe,
} from '@estiva-app/conversation'
import { heldToken } from '@/auth/heldSession'
import { relaySigningKeyOnce, viewerQuery } from '@/nostr/foreign'
import { getLiveClient } from '@/nostr/liveTopics'
import { peekRelay } from '@/nostr/relayInfo'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { heldFolderIds, subscribeHeldFolderIds } from './useFolderContents'
import { RELAY_URL, hasRelay } from './relayUrl'

/**
 * How many reactions to you a cold open reads: the newest 300. Why: load cost (ACT-7) — the read must not grow with
 * every 👍 you were ever given; what arrives after it comes live.
 */
export const REACTIONS_TO_ME_READ = 300

/** A focus or a view change reads again at most this often: several rows mount the hook, one read answers them all. */
const READ_AGAIN_AFTER_MS = 10_000
/** Rows mounted again within a minute draw what is held, with no read. */
const HELD_FRESH_MS = 60_000

/** What the tab knows about the reactions to its viewer. */
export interface ReactionsToMe {
  /** False until the stored read and its messages have answered once: a row judges nothing orange before. */
  ready: boolean
  /** The reactions to your messages, newest first, one per person, message and emoji. */
  list: readonly ReactionToMe[]
  /** Each reaction's conversation (`reactionStreamOf`): the §11.1 contexts of the stream its message is in, by reaction id. */
  streamOf: ReadonlyMap<string, readonly string[]>
  /** The messages reacted to, by id. */
  targetOf: ReadonlyMap<string, SignedEvent>
  /** The reactions in each conversation, by every context of its stream. */
  byContext: ReadonlyMap<string, readonly ReactionToMe[]>
}

const EMPTY: ReactionsToMe = { ready: false, list: [], streamOf: new Map(), targetOf: new Map(), byContext: new Map() }

interface Held {
  pubkey: string | null
  reactions: Map<string, SignedEvent>
  targets: Map<string, SignedEvent>
  /** Message ids asked by `{ids}` already, found or not: never asked twice. */
  asked: Set<string>
  /** The `kind:5`s heard: the shared rule checks who signed each. */
  deletions: Map<string, SignedEvent>
  /** `undefined` until asked; `null` when the relay's key could not be read. */
  relayKey: string | null | undefined
  ready: boolean
  readAt: number
}

const fresh = (pubkey: string | null): Held => ({
  pubkey,
  reactions: new Map(),
  targets: new Map(),
  asked: new Set(),
  deletions: new Map(),
  relayKey: undefined,
  ready: false,
  readAt: 0,
})

let held: Held = fresh(null)
let snapshot: ReactionsToMe = EMPTY
const listeners = new Set<() => void>()
let users = 0
let reading: Promise<void> | null = null
/** The `#p` request kept open: the teams it names by `#h`, or null where it names none. */
let live: { pubkey: string; teams: readonly string[] | null; close: () => void } | null = null
/** The viewer whose live request is being opened (the relay's NIP-11 is awaited): not opened twice meanwhile. */
let liveOpening: string | null = null
let takeBack: { key: string; close: () => void } | null = null
let targetsQueued: Promise<void> | null = null
/** A reaction heard while its messages' read was in flight: that read took its list already, so another follows. */
let targetsAgain = false
/** The Folder listing's watch: a team the tab comes to hold is named by the live request. */
let unwatchFolders: (() => void) | null = null

function viewer(): { relayUrl: string; token: NonNullable<ReturnType<typeof heldToken>> } | null {
  const token = heldToken()
  if (!hasRelay || !RELAY_URL || !token) return null
  return { relayUrl: RELAY_URL, token }
}

/** A different person signed in: what was held was theirs. */
function forViewer(pubkey: string): void {
  if (held.pubkey === pubkey) return
  live?.close()
  live = null
  takeBack?.close()
  takeBack = null
  held = fresh(pubkey)
  reading = null
  targetsQueued = null
  targetsAgain = false
  liveOpening = null
  publish()
}

function publish(): void {
  const me = held.pubkey
  if (!me || !held.ready) {
    snapshot = held.ready ? { ...EMPTY, ready: true } : EMPTY
  } else {
    const list = reactionsToMe([...held.reactions.values()], held.targets, me, {
      relayKey: held.relayKey ?? null,
      deletions: [...held.deletions.values()],
      nowMs: Date.now(),
    })
    const streamOf = new Map<string, readonly string[]>()
    const byContext = new Map<string, ReactionToMe[]>()
    for (const reaction of list) {
      const target = held.targets.get(reaction.target)
      const contexts = target ? reactionStreamOf(target) : []
      streamOf.set(reaction.id, contexts)
      for (const context of contexts) {
        const in_ = byContext.get(context)
        if (in_) in_.push(reaction)
        else byContext.set(context, [reaction])
      }
    }
    snapshot = { ready: true, list, streamOf, targetOf: held.targets, byContext }
  }
  watchTakeBacks()
  for (const listener of listeners) listener()
}

/** Ask for the messages reacted to that the tab does not hold, in one filter, then the relay's key when one may be needed. */
async function readTargets(): Promise<void> {
  const at = viewer()
  if (!at || held.pubkey !== at.token.pubkey) return
  const mine = held
  const missing = [...new Set([...mine.reactions.values()].map(reactionTargetOf).filter((id): id is string => !!id && !mine.targets.has(id) && !mine.asked.has(id)))]
  if (missing.length > 0) {
    for (const id of missing) mine.asked.add(id)
    try {
      const events = await viewerQuery(at.relayUrl, at.token)([{ ids: missing, limit: missing.length }])
      if (held !== mine) return
      for (const event of events) mine.targets.set(event.id.toLowerCase(), event)
    } catch (error) {
      // Asked again on the next read: a refused read is not "no such message".
      for (const id of missing) mine.asked.delete(id)
      console.warn('[reactions] could not read the messages reacted to:', error)
    }
  }
  if (mine.relayKey === undefined && [...mine.reactions.values(), ...mine.targets.values()].some((event) => needsRelayKey(event))) {
    mine.relayKey = await relaySigningKeyOnce(at.relayUrl, at.token).catch(() => null)
  }
}

/**
 * Reactions heard live arrive one at a time: their messages are asked together, once the burst has landed. One heard
 * while that read is in flight is asked by the next read, once it answers.
 */
function queueTargets(): void {
  if (targetsQueued) {
    targetsAgain = true
    return
  }
  const mine = held
  targetsQueued = Promise.resolve()
    .then(readTargets)
    .finally(() => {
      if (held !== mine) return
      targetsQueued = null
      publish()
      // A message reacted to may be in a team the live request does not name yet.
      void watchLive()
      if (targetsAgain) {
        targetsAgain = false
        queueTargets()
      }
    })
}

/** The stored read: the newest {@link REACTIONS_TO_ME_READ} reactions to you, then what they react to. */
function read(): Promise<void> {
  const at = viewer()
  if (!at) return Promise.resolve()
  forViewer(at.token.pubkey)
  if (reading) return reading
  const mine = held
  mine.readAt = Date.now()
  // A key the relay could not give is asked again with the next read.
  if (mine.relayKey === null) mine.relayKey = undefined
  reading = (async () => {
    try {
      const events = await viewerQuery(at.relayUrl, at.token)([{ ...reactionsToMeFilter(at.token.pubkey), limit: REACTIONS_TO_ME_READ }])
      if (held !== mine) return
      for (const event of events) mine.reactions.set(event.id, event)
      await readTargets()
      if (held !== mine) return
      mine.ready = true
      publish()
    } catch (error) {
      console.warn('[reactions] could not read the reactions to your messages:', error)
    } finally {
      if (held === mine) reading = null
    }
  })()
  return reading
}

/**
 * The `#p` request kept open, from the stored read's start: what is said after it asked, heard as it is said. On a
 * relay that needs teams named, it opens once the tab knows a team, and again whenever it comes to know another.
 */
async function watchLive(): Promise<void> {
  const at = viewer()
  if (!at || users === 0) return
  const pubkey = at.token.pubkey
  // Open by `#p` alone: it hears every team already.
  if (liveOpening === pubkey || (live?.pubkey === pubkey && live.teams === null)) return
  const client = getLiveClient(at.relayUrl)
  if (!client) return
  liveOpening = pubkey
  let namesTeams: boolean
  try {
    // why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-request-kept-open-hears-what-asking-again-would-return.md
    namesTeams = await relayNamesTeams(peekRelay()).catch(() => true)
  } finally {
    if (liveOpening === pubkey) liveOpening = null
  }
  if (held.pubkey !== pubkey || users === 0) return
  let teams: string[] | null = null
  if (namesTeams) {
    // A relay that delivers a team's event only to a request naming it: the teams this tab knows, and those of the messages reacted to.
    teams = [...new Set([...heldFolderIds(), ...[...held.targets.values()].flatMap((t) => t.tags.filter((tag) => tag[0] === 'h' && tag[1]).map((tag) => tag[1]))])].sort()
    // No team known yet: opened once the Folder listing or a message reacted to names one.
    if (teams.length === 0) return
    const named = live?.pubkey === pubkey ? live.teams : undefined
    if (named && teams.every((team) => named.includes(team))) return
  }
  // From when the stored read asked, never the clock after it answered: what was said between is heard too.
  const since = Math.floor((held.readAt || Date.now()) / 1000)
  const filter: Record<string, unknown> = reactionsToMeFilter(pubkey, since)
  if (teams) filter['#h'] = teams
  live?.close()
  const sub = client.relay.subscribe([filter], (event) => {
    if (held.pubkey !== pubkey || event.kind !== 7 || held.reactions.has(event.id)) return
    held.reactions.set(event.id, event)
    queueTargets()
  })
  live = { pubkey, teams, close: () => sub.close() }
}

/**
 * The `kind:5` request kept open over the reactions drawn and the messages they react to, opened again when that set
 * changes. Bounded to what is drawn: a reaction that is not, or no longer, kept asks for nothing.
 */
function watchTakeBacks(): void {
  const at = viewer()
  const ids = snapshot.list.flatMap((reaction) => [reaction.id, reaction.target])
  const key = [...new Set(ids)].sort().join(',')
  if (takeBack?.key === key) return
  takeBack?.close()
  takeBack = null
  const filter = key ? reactionTakeBackFilter(key.split(',')) : null
  if (!at || !filter || users === 0) return
  const client = getLiveClient(at.relayUrl)
  if (!client) return
  const pubkey = at.token.pubkey
  const sub = client.relay.subscribe([filter as Record<string, unknown>], (event) => {
    if (held.pubkey !== pubkey || event.kind !== 5 || held.deletions.has(event.id)) return
    held.deletions.set(event.id, event)
    publish()
  })
  takeBack = { key, close: () => sub.close() }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const current = () => snapshot

/** Start the source on the first row that reads it: the stored read, then the live requests. */
function start(): () => void {
  users += 1
  if (users === 1) {
    // Coming back to the rows a moment later reads nothing again: what is held is drawn, and the live requests reopen.
    const recent = held.ready && held.pubkey === viewer()?.token.pubkey && Date.now() - held.readAt < HELD_FRESH_MS
    unwatchFolders = subscribeHeldFolderIds(() => void watchLive())
    void (recent ? Promise.resolve() : read()).then(openLive)
  }
  return () => {
    users -= 1
    if (users > 0) return
    unwatchFolders?.()
    unwatchFolders = null
    live?.close()
    live = null
    takeBack?.close()
    takeBack = null
  }
}

/** After a read: the live requests, unless every row reading the source has gone meanwhile. */
function openLive(): void {
  if (users === 0) return
  void watchLive()
  watchTakeBacks()
}

/** Focus or a view change: read again, unless a read has just been made; a live request closed meanwhile is opened again. */
function refresh(): void {
  if (users === 0 || Date.now() - held.readAt < READ_AGAIN_AFTER_MS) return
  void read().then(openLive)
}

const noSubscribe = () => () => {}
const nothing = () => EMPTY

/**
 * The reactions to your messages, as this tab knows them: one source, read once, kept live (ACT-7). Not `enabled`
 * (a place that draws no orange), it reads nothing and is not drawn again when a reaction arrives.
 */
export function useReactionsToMe(enabled = true): ReactionsToMe {
  useEffect(() => (enabled ? start() : undefined), [enabled])
  useRefreshTriggers(refresh, { enabled: hasRelay && enabled, interval: false })
  return useSyncExternalStore(enabled ? subscribe : noSubscribe, enabled ? current : nothing, enabled ? current : nothing)
}

/** Test seam: forget everything held and close what is open. */
export function resetReactionsToMeForTests(): void {
  unwatchFolders?.()
  unwatchFolders = null
  live?.close()
  live = null
  liveOpening = null
  takeBack?.close()
  takeBack = null
  held = fresh(null)
  snapshot = EMPTY
  reading = null
  targetsQueued = null
  targetsAgain = false
  users = 0
}
