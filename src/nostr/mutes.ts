/**
 * What the viewer has muted — the one private list left of following (CON-19).
 *
 * SPEC §11.8 *Muting is private*: a member MAY mute a file or a Folder's
 * general stream and be told about it only when a message names them. The
 * list is `kind:30078`, `d` = `estiva:muted:v1`, NIP-44 encrypted to self,
 * whole blob and last write wins (§12.3) — `@estiva-app/conversation` owns the
 * shape, this file reads and writes it through Peek's encryption and signer.
 *
 * ## The retired follow list
 *
 * `estiva:followed:v1` (FOL-30) is read once more and never written again. Its
 * `muted` keys become this list: while no mute list exists, they are read as
 * one, and the first toggle writes the list that supersedes them. Its followed
 * keys are not published as anything — that list was private, and nothing may
 * turn it into a public membership without the person choosing to join.
 */
import type { SignedEvent } from '@estiva-app/protocol'
import { KIND } from '@estiva-app/protocol'
import {
  buildMutedEvent,
  mutedFilter,
  mutedFromFollowed,
  parseMutedBlob,
  serializeMutedBlob,
} from '@estiva-app/conversation'
import { publishSigned, queryRelay, signViaEstivaId } from './bridge'
import { decryptBlob, encryptBlob } from './appData'
import type { RelaySeam } from './stars'

/** The retired list, read once more for its mutes. */
const LEGACY_FOLLOWED_D_TAG = 'estiva:followed:v1'

/**
 * What the relay had to say, with the answers kept apart for the reason stars
 * keeps them: `absent` is an empty list to render and a coordinate to write;
 * `unreachable` is a publish that must not happen, because last-write-wins
 * would make a list written from a guess permanent.
 */
export type MutesRead =
  | { state: 'unreachable' }
  /** No mute list yet. `keys` are the retired follow list's mutes, or none. */
  | { state: 'absent'; keys: string[] }
  | { state: 'present'; keys: string[] }

const newest = (events: readonly SignedEvent[]): SignedEvent | undefined => [...events].sort((a, b) => b.created_at - a.created_at)[0]

export async function fetchMutes(seam: RelaySeam): Promise<MutesRead> {
  const mine = await queryRelay(seam.relayUrl, [mutedFilter(seam.pubkey)], seam.accessToken, seam.pubkey)
  if (!mine.ok) return { state: 'unreachable' }
  const current = newest(mine.events)
  if (current) {
    const plaintext = await decryptBlob(current.content, seam.accessToken)
    // The blob is there and what failed is this tab's key: not an empty list.
    if (plaintext === undefined) return { state: 'unreachable' }
    const list = parseMutedBlob(plaintext)
    // A blob that is not a v1 list says nothing usable; treat it as absent so the next toggle rewrites it.
    return list ? { state: 'present', keys: list.keys } : { state: 'absent', keys: [] }
  }
  const legacy = await queryRelay(
    seam.relayUrl,
    [{ kinds: [KIND.APP_DATA], authors: [seam.pubkey], '#d': [LEGACY_FOLLOWED_D_TAG] }],
    seam.accessToken,
    seam.pubkey,
  )
  if (!legacy.ok) return { state: 'unreachable' }
  const old = newest(legacy.events)
  if (!old) return { state: 'absent', keys: [] }
  const plaintext = await decryptBlob(old.content, seam.accessToken)
  if (plaintext === undefined) return { state: 'unreachable' }
  return { state: 'absent', keys: mutedFromFollowed(plaintext) }
}

/** Encrypt, sign and publish the whole mute list. */
export async function publishMutes(
  keys: Iterable<string>,
  nowMs: number,
  seam: RelaySeam,
): Promise<{ ok: boolean; eventId?: string; reason?: string }> {
  const ciphertext = await encryptBlob(serializeMutedBlob(keys, nowMs), seam.accessToken)
  const unsigned = buildMutedEvent(seam.pubkey, nowMs, ciphertext)
  let signed: SignedEvent
  try {
    signed = await signViaEstivaId(unsigned, seam.accessToken, seam.pubkey)
  } catch (error) {
    return { ok: false, reason: `could not sign kind:${KIND.APP_DATA}: ${(error as Error).message}` }
  }
  const result = await publishSigned(seam.relayUrl, signed, seam.accessToken, seam.pubkey)
  return { ok: result.ok, eventId: result.eventId, reason: result.reason }
}
