/**
 * Following a place (TEA-6): a topic, a space or a team's chat. One read of
 * what decides how the viewer is in it and who it lists, and the writes of the
 * switch (Not following, Important, All, back to the team's default) and of
 * Add — every rule `@estiva-app/conversation`'s, so Ship and Peek write and
 * list the same way (SPEC §11.8 *Places and following*).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-persons-level-on-a-place-is-theirs-alone.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-place-lists-who-chose-a-level-and-its-teams-members.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/anyone-may-add-a-person-to-a-file.md
 */
import { KIND, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
import {
  buildMutedEvent,
  buildPlaceAdd,
  buildTeamsEvent,
  followingOf,
  parseTeamsBlob,
  placeFilters,
  serializeMutedBlob,
  serializeTeamsBlob,
  switchWrites,
  withPlaceOff,
  type Place,
  type PlaceFacts,
  type SwitchChoice,
} from '@estiva-app/conversation'
import type { QueryFn } from '@estiva-app/interop'
import type { StoredToken } from '@/auth/estivaId'
import { publishSigned, signViaEstivaId } from './bridge'
import { decryptBlob, encryptBlob } from './appData'
import { viewerQuery } from './foreign'
import { fetchMutes } from './mutes'
import { readTeamsListAsViewer, type TeamWrite, type TeamsListRead } from './teams'

/** What one place's switch and its Who follows are drawn from. */
export interface PlaceRead {
  /** `placeFilters`' answer, with the viewer's teams list decrypted. `archived` is the caller's. */
  facts: Omit<PlaceFacts, 'archived'>
  /** The viewer's teams list as read: an `unreachable` one is never written over. */
  teamsList: TeamsListRead
}

const KIND_ROSTER = 39002
const KIND_FOLDER_STATE = 30890
const KIND_FOLDER_COMMAND = 1852
const ROSTER_COMMANDS: readonly number[] = [KIND.NIP29_PUT_USER, KIND.NIP29_REMOVE_USER, KIND.NIP29_JOIN, KIND.NIP29_LEAVE, KIND.NIP29_CREATE_GROUP]

/**
 * One place's facts for `person`: its root and changes, its team's roster,
 * list and the commands naming it, and the person's teams list — one
 * `POST /query`. Throws when the read fails: a failed read is not "nobody".
 */
export async function readPlace(place: Place, person: string, query: QueryFn, decrypt: (ciphertext: string) => Promise<string | undefined>): Promise<PlaceRead> {
  const events = await query(placeFilters(place, person) as Record<string, unknown>[])
  const own: SignedEvent[] = []
  const placeEvents: SignedEvent[] = []
  const roster: SignedEvent[] = []
  const listing: SignedEvent[] = []
  for (const event of events) {
    if (event.kind === KIND.APP_DATA) {
      if (event.pubkey === person) own.push(event)
    } else if (event.kind === KIND_ROSTER || ROSTER_COMMANDS.includes(event.kind)) roster.push(event)
    else if (event.kind === KIND_FOLDER_STATE || event.kind === KIND_FOLDER_COMMAND) listing.push(event)
    else placeEvents.push(event)
  }
  const teamsList = await readTeamsListFrom(own, decrypt)
  return {
    facts: { events: placeEvents, roster, listing, ...(teamsList.state === 'present' ? { teams: teamsList.list } : {}) },
    teamsList,
  }
}

async function readTeamsListFrom(events: readonly SignedEvent[], decrypt: (ciphertext: string) => Promise<string | undefined>): Promise<TeamsListRead> {
  const newest = [...events].sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return { state: 'absent' }
  const plaintext = await decrypt(newest.content)
  if (plaintext === undefined) return { state: 'unreachable' }
  const list = parseTeamsBlob(plaintext)
  return list ? { state: 'present', list } : { state: 'absent' }
}

/** {@link readPlace} as the viewer. */
export function readPlaceAsViewer(place: Place, relayUrl: string, token: StoredToken): Promise<PlaceRead> {
  return readPlace(place, token.pubkey, viewerQuery(relayUrl, token), (ciphertext) => decryptBlob(ciphertext, token.accessToken))
}

async function publish(unsigned: UnsignedEvent, relayUrl: string, token: StoredToken): Promise<boolean> {
  const signed = await signViaEstivaId(unsigned, token.accessToken, token.pubkey)
  const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
  // The relay's words stay in the console; the toast says it plainly.
  if (!result.ok) console.warn(`[places] kind:${unsigned.kind} refused:`, result.reason)
  return result.ok
}

/**
 * One pick on a place's switch, as the viewer (§11.8): the public changes
 * `switchWrites` gives, then the private `off` entry in the teams list (read
 * again just before, and never written over when it cannot be read), then a
 * mute already kept taken out when a level or the default is picked.
 */
export async function choosePlaceLevelAsViewer(
  args: { place: Place; folder: string; choice: SwitchChoice; read: PlaceRead; archived: boolean; muted: boolean },
  relayUrl: string,
  token: StoredToken,
): Promise<TeamWrite> {
  const { place, folder, choice, read } = args
  const teams = read.teamsList.state === 'present' ? read.teamsList.list : undefined
  const following = followingOf(place, token.pubkey, { ...read.facts, archived: args.archived })
  const writes = switchWrites(token.pubkey, Date.now(), { place, folder, choice, following, ...(teams ? { teams } : {}) })
  if (writes.off && read.teamsList.state === 'unreachable') {
    return { ok: false, reason: 'Your followed teams could not be read, so nothing was changed. Try again.' }
  }
  for (const change of writes.changes) {
    if (!(await publish(change, relayUrl, token))) return { ok: false, reason: 'Nothing changed. Try again.' }
  }
  if (writes.off) {
    const fresh = await readTeamsListAsViewer(relayUrl, token)
    if (fresh.state === 'unreachable') return { ok: false, reason: 'Your followed teams could not be read, so it was only partly changed. Try again.' }
    const now = Date.now()
    const next = withPlaceOff(fresh.state === 'present' ? fresh.list : undefined, writes.off)
    const ciphertext = await encryptBlob(serializeTeamsBlob(next, now), token.accessToken)
    if (!(await publish(buildTeamsEvent(token.pubkey, now, ciphertext), relayUrl, token))) {
      return { ok: false, reason: 'It was only partly changed. Try again.' }
    }
  }
  if (writes.clearsMute && args.muted) {
    const unmuted = await unmuteAsViewer(place.address, relayUrl, token)
    if (!unmuted.ok) return unmuted
  }
  return { ok: true }
}

/**
 * Take a place out of the viewer's private mute list (§11.8 *Muting*): the
 * whole list, read again just before, written back without it. A list that is
 * there and cannot be read is never written over.
 */
export async function unmuteAsViewer(address: string, relayUrl: string, token: StoredToken): Promise<TeamWrite> {
  // `fetchMutes` reads the retired follow list's mutes too, while no mute list exists: those are taken out the same way.
  const read = await fetchMutes({ relayUrl, accessToken: token.accessToken, pubkey: token.pubkey })
  if (read.state === 'unreachable') return { ok: false, reason: 'Your muted list could not be read, so it is still muted. Try again.' }
  if (!read.keys.includes(address)) return { ok: true }
  const now = Date.now()
  const ciphertext = await encryptBlob(serializeMutedBlob(read.keys.filter((key) => key !== address), now), token.accessToken)
  return (await publish(buildMutedEvent(token.pubkey, now, ciphertext), relayUrl, token)) ? { ok: true } : { ok: false, reason: 'It is still muted. Try again.' }
}

/** Add someone to a place (§11.8): a `member:<P>` = `true`, naming their leave with `prev` when they left. */
export async function addToPlaceAsViewer(args: { place: Place; folder: string; person: string; read: PlaceRead }, relayUrl: string, token: StoredToken): Promise<TeamWrite> {
  const unsigned = buildPlaceAdd(token.pubkey, Date.now(), { place: args.place, folder: args.folder, person: args.person, events: args.read.facts.events })
  return (await publish(unsigned, relayUrl, token)) ? { ok: true } : { ok: false, reason: 'They were not added. Try again.' }
}
