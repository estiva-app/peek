/**
 * What the viewer has muted — the one private list left of following (CON-19).
 *
 * SPEC §11.8 *Muting is private*: a member MAY mute a file and be told about
 * it only when a message names them. The list is `kind:30078`, `d` =
 * `estiva:muted:v1`, NIP-44 encrypted to self; `@estiva-app/conversation` owns
 * the shape and this file reads it through Peek's decryption.
 *
 * ## Read-only for now
 *
 * Peek has no control to mute (Miky, 2026-10-01: not worth the surface yet),
 * so it reads the list — a mute made elsewhere, or carried over from following,
 * still holds — and never writes it.
 *
 * ## The retired follow list
 *
 * `estiva:followed:v1` (FOL-30) is read once more and never written again. Its
 * `muted` keys become this list: while no mute list exists, they are read as
 * one. Its followed keys are not published as anything — that list was private,
 * and nothing may turn it into a public membership without the person choosing
 * to join.
 */
import type { SignedEvent } from '@estiva-app/protocol'
import { KIND } from '@estiva-app/protocol'
import { mutedFilter, mutedFromFollowed, parseMutedBlob } from '@estiva-app/conversation'
import { queryRelay } from './bridge'
import { decryptBlob } from './appData'
import type { RelaySeam } from './stars'

/** The retired list, read once more for its mutes. */
const LEGACY_FOLLOWED_D_TAG = 'estiva:followed:v1'

/**
 * What the relay had to say: `absent` is an empty list; `unreachable` is a
 * read that did not answer, which must not be taken for an empty one.
 */
export type MutesRead =
  | { state: 'unreachable' }
  /** No mute list yet. `keys` are the retired follow list's mutes, or none. */
  | { state: 'absent'; keys: string[] }
  | { state: 'present'; keys: string[] }

const newest = (events: readonly SignedEvent[]): SignedEvent | undefined => [...events].sort((a, b) => b.created_at - a.created_at)[0]

/**
 * A blob's plaintext, decrypted once per event. The list is read on every
 * refresh trigger and an event never changes, so the second read of the same
 * one costs no `/nip44/decrypt` — which the relay meters, and answers 429 to
 * after a handful of calls in a row. Only a success is kept.
 */
const decrypted = new Map<string, string>()
async function plaintextOf(event: SignedEvent, token: string): Promise<string | undefined> {
  const kept = decrypted.get(event.id)
  if (kept !== undefined) return kept
  const plaintext = await decryptBlob(event.content, token)
  if (plaintext !== undefined) decrypted.set(event.id, plaintext)
  return plaintext
}

export async function fetchMutes(seam: RelaySeam): Promise<MutesRead> {
  const mine = await queryRelay(seam.relayUrl, [mutedFilter(seam.pubkey)], seam.accessToken, seam.pubkey)
  if (!mine.ok) return { state: 'unreachable' }
  const current = newest(mine.events)
  if (current) {
    const plaintext = await plaintextOf(current, seam.accessToken)
    // The blob is there and what failed is this tab's key: not an empty list.
    if (plaintext === undefined) return { state: 'unreachable' }
    const list = parseMutedBlob(plaintext)
    // A list this build cannot read says nothing it can apply.
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
  const plaintext = await plaintextOf(old, seam.accessToken)
  if (plaintext === undefined) return { state: 'unreachable' }
  return { state: 'absent', keys: mutedFromFollowed(plaintext) }
}
