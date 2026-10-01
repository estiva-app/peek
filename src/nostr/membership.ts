/**
 * Which files and Folders the viewer is told about — SPEC §11.8 (CON-19).
 *
 * **A person is told about a file's conversation when they are a member of
 * it.** It replaces following (FOL-30), a private list only Peek kept. The
 * rule is `@estiva-app/conversation`'s; this file is the reading half Peek
 * owns: which events to ask the relay for, and how to hand them to the fold.
 *
 * ## What is read
 *
 * One request of three filters (`membershipFilters`): the `kind:1851` changes
 * that name the viewer, what they wrote, and what mentions them — bounded by
 * the read horizon Peek judges unread over (`PEEK_HORIZON_DAYS`), because
 * nothing before it can light a dot anyway. Each file those events name is a
 * candidate, folded with `membershipOf`. Membership the horizon hides lapses
 * for this client alone and comes back with the next event naming the person
 * (§11.8 *The fold*).
 *
 * ## Created is the address
 *
 * A file's address names its author, so a file the viewer created needs no
 * query: it is theirs unless a leave of theirs says otherwise. That leave is
 * among the changes naming them, so a candidate file whose address is the
 * viewer's is folded with its root added, dated to the horizon's start —
 * the earliest the viewer could be told about.
 *
 * ## A Folder's general stream is the roster
 *
 * §11.8 *grain*: a Folder's members are its channel's `kind:39002` member
 * list, which the relay owns. `rosterFilter` finds the lists naming the
 * viewer in one request.
 *
 * ## Mentions
 *
 * A mention breaks through a mute, and it counts in a Folder the viewer is not
 * on the roster of. The messages that name the viewer arrive in the same
 * request, so their ids are kept (`mentioned`).
 */
import type { SignedEvent } from '@estiva-app/protocol'
import {
  candidateFilesOf,
  fileContext,
  membershipFilters,
  membershipOf,
  mentions,
  type Membership,
} from '@estiva-app/conversation'
import { queryRelay } from './bridge'
import { PEEK_HORIZON_DAYS } from './readState'
import type { RelaySeam } from './stars'

/** Per filter. Measured on production as the agent, the most-named identity there: 700 events in 90 days. */
export const MEMBERSHIP_LIMIT = 1000

/** `kind:39002`, a channel's member list (RFC 0.4 §5). */
export const KIND_CHANNEL_MEMBERS = 39002

const HORIZON_SECONDS = PEEK_HORIZON_DAYS * 24 * 60 * 60

/** The three filters that find every file the viewer may be a member of, bounded by the horizon. */
export function membershipQueries(pubkey: string, nowSeconds: number, limit = MEMBERSHIP_LIMIT): Record<string, unknown>[] {
  return membershipFilters(pubkey, nowSeconds - HORIZON_SECONDS).map((filter) => ({ ...filter, limit }))
}

/** The Folders whose roster names the viewer — the grain of a general stream. */
export function rosterFilter(pubkey: string): Record<string, unknown> {
  return { kinds: [KIND_CHANNEL_MEMBERS], '#p': [pubkey] }
}

/** The channel uuids a roster event set names the viewer on. */
export function rosterOf(events: readonly SignedEvent[]): Set<string> {
  const channels = new Set<string>()
  for (const event of events) {
    if (event.kind !== KIND_CHANNEL_MEMBERS) continue
    const d = event.tags.find((t) => t[0] === 'd')?.[1]
    if (d) channels.add(d.toLowerCase())
  }
  return channels
}

/** What the relay says the viewer is a member of. */
export interface MembershipRead {
  /** Every candidate file, folded: the ones the viewer is in and the ones they left. */
  files: ReadonlyMap<string, Membership>
  /** Ids of the messages whose content names the viewer. */
  mentioned: ReadonlySet<string>
  /** Unix seconds a created file's membership starts at — the horizon's start. */
  floor: number
}

/** The address's author, or undefined when it is not a file address. */
export function authorOfAddress(address: string): string | undefined {
  if (fileContext(address) === undefined) return undefined
  return address.split(':')[1]
}

/** Fold what the three filters returned. Pure: the clock is `nowSeconds`. */
export function foldMemberships(pubkey: string, events: readonly SignedEvent[], nowSeconds: number): MembershipRead {
  const floor = nowSeconds - HORIZON_SECONDS
  const byFile = new Map<string, SignedEvent[]>()
  const mentioned = new Set<string>()
  for (const event of events) {
    if (mentions(event, pubkey)) mentioned.add(event.id)
    for (const file of candidateFilesOf(event)) {
      const list = byFile.get(file)
      if (list) list.push(event)
      else byFile.set(file, [event])
    }
  }
  const files = new Map<string, Membership>()
  for (const [file, held] of byFile) {
    const [kind, , d] = file.split(':')
    const own = authorOfAddress(file) === pubkey
    // The root the viewer created, when they did — ordered before everything else for the file.
    const root = own ? [{ id: '', pubkey, kind: Number(kind), created_at: floor, tags: [['d', d ?? '']], content: '', sig: '' }] : []
    files.set(file, membershipOf(file, pubkey, [...root, ...held]))
  }
  return { files, mentioned, floor }
}

/** The membership read, or `undefined` when the relay did not answer — never an empty guess. */
export async function fetchMembership(
  seam: RelaySeam,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<MembershipRead | undefined> {
  const { ok, events } = await queryRelay(seam.relayUrl, membershipQueries(seam.pubkey, nowSeconds), seam.accessToken, seam.pubkey)
  return ok ? foldMemberships(seam.pubkey, events, nowSeconds) : undefined
}

/** The roster read, or `undefined` when the relay did not answer. */
export async function fetchRoster(seam: RelaySeam): Promise<Set<string> | undefined> {
  const { ok, events } = await queryRelay(seam.relayUrl, [rosterFilter(seam.pubkey)], seam.accessToken, seam.pubkey)
  return ok ? rosterOf(events) : undefined
}
