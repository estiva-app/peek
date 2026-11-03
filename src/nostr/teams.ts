/**
 * Teams (TEA-5): who is in each team, which topics it marks as its spaces,
 * and which teams the viewer follows — read for every listed team at once —
 * and the writes that change them: join, leave, add someone, follow, mark a
 * space.
 *
 * A team is a Folder (`a-team-is-the-folder…`), so its id is the Folder's
 * uuid: the `d` of its `39002` roster and its `30890` list, and the `h` on
 * its commands. Who is in a team is public; who follows one is the
 * follower's own encrypted `kind:30078` (§11.8), last write wins.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-team-holds-three-kinds-of-place-and-add-puts-you-in-one.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/anyone-may-join-an-open-team-and-only-its-members-add-or-mark.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-team-has-members-and-followers-and-a-place-is-followed-at-a-level.md
 */
import { buildAddMember, buildJoinGroup, buildLeaveGroup, KIND, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
import { buildTeamsEvent, parseTeamsBlob, serializeTeamsBlob, teamsFilter, type TeamsList } from '@estiva-app/conversation'
import { KIND_FOLDER_STATE, listEntries, planMarkSpace, type QueryFn } from '@estiva-app/interop'
import type { StoredToken } from '@/auth/estivaId'
import { publishSigned, signViaEstivaId } from './bridge'
import { decryptBlob, encryptBlob } from './appData'
import { viewerQuery } from './foreign'

/** A team's roster as the relay keeps it: `kind:39002`, relay-signed, `d` the team. */
export const KIND_ROSTER = 39002

/** The stored commands a member's start is read from: put, remove, join, leave, and the team's creation. */
const ROSTER_COMMANDS = [KIND.NIP29_PUT_USER, KIND.NIP29_REMOVE_USER, KIND.NIP29_JOIN, KIND.NIP29_LEAVE, KIND.NIP29_CREATE_GROUP]

/** A topic (§6.14), and a change to a file (its list entries among them). */
const KIND_BARE_FILE = 30840
const KIND_CHANGE = 1851

/** Buzz's ceiling per filter; a team's commands over its whole life stay far below it (54 across 13 teams, 3 Nov). */
const COMMANDS_LIMIT = 1_000

/** One read for every team listed: rosters, the commands behind them, each team's list, and the viewer's teams list. */
export function teamsFilters(teams: readonly string[], viewer: string): Record<string, unknown>[] {
  return [
    { kinds: [KIND_ROSTER], '#d': [...teams] },
    { kinds: ROSTER_COMMANDS, '#h': [...teams], limit: COMMANDS_LIMIT },
    { kinds: [KIND_FOLDER_STATE], '#d': [...teams] },
    teamsFilter(viewer),
  ]
}

/** The viewer's teams list: kept, none kept yet, or there and unreadable (never overwritten from a guess). */
export type TeamsListRead = { state: 'present'; list: TeamsList } | { state: 'absent' } | { state: 'unreachable' }

export interface TeamsRead {
  /** Per team: its `39002` and the stored commands naming it — `teamMembersOf`'s and `followingOf`'s roster. */
  rosters: Record<string, SignedEvent[]>
  /** Per team: its `30890` — what it lists, and which of those are its spaces. */
  listings: Record<string, SignedEvent[]>
  teamsList: TeamsListRead
}

const tagOf = (event: SignedEvent, name: string) => event.tags.find((t) => t[0] === name)?.[1]

/** The events by team, and the viewer's list decrypted. Throws when the read fails, so a failure never draws as "in no team". */
export async function readTeams(
  teams: readonly string[],
  viewer: string,
  query: QueryFn,
  decrypt: (ciphertext: string) => Promise<string | undefined>,
): Promise<TeamsRead> {
  const rosters: Record<string, SignedEvent[]> = {}
  const listings: Record<string, SignedEvent[]> = {}
  for (const team of teams) {
    rosters[team] = []
    listings[team] = []
  }
  if (teams.length === 0) return { rosters, listings, teamsList: await readTeamsList(viewer, query, decrypt) }
  const events = await query(teamsFilters(teams, viewer))
  let own: SignedEvent | undefined
  for (const event of events) {
    if (event.kind === KIND.APP_DATA) {
      if (event.pubkey === viewer && (!own || event.created_at > own.created_at)) own = event
      continue
    }
    const team = event.kind === KIND_ROSTER || event.kind === KIND_FOLDER_STATE ? tagOf(event, 'd') : tagOf(event, 'h')
    if (!team) continue
    if (event.kind === KIND_FOLDER_STATE) listings[team]?.push(event)
    else rosters[team]?.push(event)
  }
  return { rosters, listings, teamsList: await listOf(own, decrypt) }
}

async function readTeamsList(viewer: string, query: QueryFn, decrypt: (ciphertext: string) => Promise<string | undefined>): Promise<TeamsListRead> {
  const events = await query([teamsFilter(viewer)])
  const newest = events.filter((e) => e.pubkey === viewer).sort((a, b) => b.created_at - a.created_at)[0]
  return listOf(newest, decrypt)
}

async function listOf(event: SignedEvent | undefined, decrypt: (ciphertext: string) => Promise<string | undefined>): Promise<TeamsListRead> {
  if (!event) return { state: 'absent' }
  const plaintext = await decrypt(event.content)
  if (plaintext === undefined) return { state: 'unreachable' }
  const list = parseTeamsBlob(plaintext)
  // A list this version cannot read is no list: drawn as following nothing, and replaced only by the person's own Follow.
  return list ? { state: 'present', list } : { state: 'absent' }
}

/** The addresses a team's newest `30890` lists, each with whether it is one of the team's spaces (the `space` role). */
export function listedOf(listing: readonly SignedEvent[]): { address: string; space: boolean }[] {
  const newest = [...listing].sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return []
  return newest.tags.filter((t) => t[0] === 'a' && t[1]).map((t) => ({ address: t[1], space: t[3] === 'space' }))
}

/** The teams list after following or unfollowing one; `undefined` when nothing changes. */
export function followedList(current: TeamsList | undefined, team: string, follow: boolean, nowMs: number): Pick<TeamsList, 'teams' | 'off'> | undefined {
  const teams = { ...(current?.teams ?? {}) }
  if (follow === team in teams) return undefined
  if (follow) teams[team] = nowMs
  else delete teams[team]
  return { teams, off: current?.off ?? [] }
}

export type TeamWrite = { ok: true } | { ok: false; reason: string }

async function publish(unsigned: UnsignedEvent, relayUrl: string, token: StoredToken, refused: string): Promise<TeamWrite> {
  const signed = await signViaEstivaId(unsigned, token.accessToken, token.pubkey)
  const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
  // In Peek's words, never the relay's: "blocked: not a channel member" says nothing to a person.
  if (!result.ok) console.warn(`[teams] kind:${unsigned.kind} refused:`, result.reason)
  return result.ok ? { ok: true } : { ok: false, reason: `${refused} Try again.` }
}

/** Join a team: a `kind:9021` the viewer signs (§3.3). The relay refuses it on a team that is not open. */
export function joinTeamAsViewer(team: string, relayUrl: string, token: StoredToken): Promise<TeamWrite> {
  return publish(buildJoinGroup(token.pubkey, Date.now(), { channelUuid: team }), relayUrl, token, 'You did not join the team.')
}

/** Leave a team: a `kind:9022` the viewer signs. NIP-29 keeps a sole owner in. */
export function leaveTeamAsViewer(team: string, relayUrl: string, token: StoredToken): Promise<TeamWrite> {
  return publish(buildLeaveGroup(token.pubkey, Date.now(), { channelUuid: team }), relayUrl, token, 'You are still in the team.')
}

/** Add someone to a team the viewer is in: a `kind:9000` naming them. */
export function addToTeamAsViewer(team: string, person: string, relayUrl: string, token: StoredToken): Promise<TeamWrite> {
  return publish(buildAddMember(token.pubkey, Date.now(), { channelUuid: team, targetPubkey: person }), relayUrl, token, 'They were not added.')
}

/** Mark a topic one of a team's spaces, or take the mark off: one `kind:1852 add` (§3.3). Only the team's members may. */
export function markSpaceAsViewer(team: string, address: string, space: boolean, relayUrl: string, token: StoredToken): Promise<TeamWrite> {
  return publish(planMarkSpace(token.pubkey, Date.now(), { team, address, space }), relayUrl, token, space ? 'It is not a space yet.' : 'It is still a space.')
}

/**
 * Follow a team, or stop: the whole teams list, read again just before, with
 * one team changed (§12.3, last write wins). A list that is there and cannot
 * be read is never written over.
 */
export async function followTeamAsViewer(team: string, follow: boolean, relayUrl: string, token: StoredToken): Promise<TeamWrite> {
  const decrypt = (ciphertext: string) => decryptBlob(ciphertext, token.accessToken)
  const read = await readTeamsList(token.pubkey, viewerQuery(relayUrl, token), decrypt)
  if (read.state === 'unreachable') return { ok: false, reason: 'Your followed teams could not be read, so nothing was changed. Try again.' }
  const now = Date.now()
  const next = followedList(read.state === 'present' ? read.list : undefined, team, follow, now)
  if (!next) return { ok: true }
  const ciphertext = await encryptBlob(serializeTeamsBlob(next, now), token.accessToken)
  return publish(buildTeamsEvent(token.pubkey, now, ciphertext), relayUrl, token, follow ? 'You don’t follow it yet.' : 'You still follow it.')
}

/**
 * Which of these files some topic lists (§6.14), by id — the `d` a topic's
 * `lists:<d>` names: one read of every entry naming them, folded to the
 * newest per topic and file. What is left is what a team holds outside any
 * topic, drawn on its page as Files (Decided, 3 November).
 */
export async function listedByTopics(fileIds: readonly string[], query: QueryFn): Promise<Set<string>> {
  if (fileIds.length === 0) return new Set()
  const events = await query([{ kinds: [KIND_CHANGE], '#o': [...fileIds], limit: COMMANDS_LIMIT }])
  return new Set(listEntries(events).filter((entry) => entry.listed && entry.list.startsWith(`${KIND_BARE_FILE}:`)).map((entry) => entry.file))
}

/** {@link listedByTopics} as the viewer. */
export function listedByTopicsAsViewer(fileIds: readonly string[], relayUrl: string, token: StoredToken): Promise<Set<string>> {
  return listedByTopics(fileIds, viewerQuery(relayUrl, token))
}

/** {@link readTeams} as the viewer. */
export function readTeamsAsViewer(teams: readonly string[], relayUrl: string, token: StoredToken): Promise<TeamsRead> {
  return readTeams(teams, token.pubkey, viewerQuery(relayUrl, token), (ciphertext) => decryptBlob(ciphertext, token.accessToken))
}
