/**
 * Which files and Folders the viewer is told about — SPEC §11.8 (CON-19).
 *
 * **A person is told about a file's conversation when they are a member of
 * it.** It replaces following (FOL-30), a private list only Peek kept. The
 * rule, the three filters and their fold are `@estiva-app/conversation`'s
 * (`membershipQueries`, `foldMemberships`), shared with Ship since SHIPS-2 so
 * the two apps cannot disagree on a dot. This file is what only Peek adds:
 * the urgent mentions Desk shows (SPEC §13.1, CON-17), and the read itself.
 *
 * Membership the horizon hides lapses for this client alone and comes back
 * with the next event naming the person (§11.8 *The fold*). A Folder has
 * nothing to read (Miky, 2026-10-01): its own chat is judged by mentions alone.
 */
import type { SignedEvent } from '@estiva-app/protocol'
import { foldMemberships as foldShared, membershipQueries, type MembershipRead as SharedRead } from '@estiva-app/conversation'
import { readFrom, type ReadSource } from './readFrom'
import { isTaggedUrgentFor } from './channelStreams'
import type { RelaySeam } from './stars'

/** What the relay says the viewer is a member of, and which mentions of them are urgent. */
export interface MembershipRead extends SharedRead {
  /** Ids of the mentions urgent for the viewer (SPEC §13.1, CON-17). */
  urgent: ReadonlySet<string>
  /**
   * The `kind:1851` changes naming the viewer, by the place they name: a
   * level, an Add, a join or a leave. What the shared `followingOf` folds for
   * a topic's or a space's dot (TEA-6), with no read of its own.
   */
  changes: ReadonlyMap<string, readonly SignedEvent[]>
}

const KIND_CHANGE = 1851

/** Fold what the three filters returned, with Peek's urgent set. Pure: the clock is `nowSeconds`. */
export function foldMemberships(pubkey: string, events: readonly SignedEvent[], nowSeconds: number): MembershipRead {
  const urgent = new Set<string>()
  const changes = new Map<string, SignedEvent[]>()
  for (const event of events) {
    if (isTaggedUrgentFor(event, pubkey)) urgent.add(event.id)
    if (event.kind !== KIND_CHANGE) continue
    const place = event.tags.find((t) => t[0] === 'a')?.[1]
    if (!place) continue
    const list = changes.get(place)
    if (list) list.push(event)
    else changes.set(place, [event])
  }
  return { ...foldShared(pubkey, events, nowSeconds), urgent, changes }
}

/** The membership read, or `undefined` when the relay did not answer — never an empty guess. */
export async function fetchMembership(
  seam: RelaySeam,
  nowSeconds = Math.floor(Date.now() / 1000),
  source: ReadSource = 'relay',
): Promise<MembershipRead | undefined> {
  const { ok, events } = await readFrom(source, seam.relayUrl, membershipQueries(seam.pubkey, nowSeconds), seam.accessToken, seam.pubkey)
  return ok ? foldMemberships(seam.pubkey, events, nowSeconds) : undefined
}
