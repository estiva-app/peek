import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { followingOf, teamMembersOf, unreadOnPlace, type Following, type TeamMember, type TeamsList } from '@estiva-app/conversation'
import { topLevelFolders, type FolderSummary, type ForeignObject } from '@estiva-app/interop'
import { heldToken } from '@/auth/heldSession'
import type { StreamMessage } from '@/nostr/channelStreams'
import { listedByTopicsAsViewer, listedOf, readTeamsAsViewer, type TeamsRead } from '@/nostr/teams'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { RELAY_URL } from './relayUrl'
import { useChannelStreams } from './useChannelStreams'
import { useFolderContents, useFolders } from './useFolderContents'

/** One team, as Peek's Teams draws it (TEA-5). */
export interface Team {
  /** The Folder's uuid: the team's `h`, and its chat's read-state context. */
  id: string
  name: string
  archived: boolean
  /** The Company team (§3.4): nobody leaves it. */
  company: boolean
  /** Owners and admins: who may rename and archive it. */
  admins: readonly string[]
  /** Everyone its roster lists, in the order they joined. Agents among them; the page draws them apart. */
  members: readonly TeamMember[]
  isMember: boolean
  /** The viewer follows it, privately (§11.8). Never true of a team they are in: being in it says more. */
  isFollowing: boolean
  /** What its list holds, in its order, each with whether it is one of its spaces. */
  listed: readonly { address: string; space: boolean }[]
  /** How the viewer is in its chat: by the team's default for a member, never for anyone else (`a-teams-chat-is-followed-like-a-space`). */
  chat: Following
}

/*
  One read per tab, shared by the column and the team page: every listed team's
  roster, list and the viewer's teams list, in one `POST /query` (~25 KB on 13
  teams, 3 Nov). Read again after one of the viewer's own writes, and on the
  next mount once it is a minute old — someone else joining shows then.
*/
interface Held {
  key: string
  read?: TeamsRead
  at: number
  failed: boolean
}
const FRESH_MS = 60_000
let held: Held = { key: '', at: 0, failed: false }
let reading: Promise<void> | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const snapshot = () => held
function put(next: Held) {
  held = next
  for (const listener of listeners) listener()
}

let lastIds: readonly string[] = []

/** Read the teams again now: after a join, leave, add, follow or mark, so the change shows where it was made. */
export function reloadTeamsOnScreen(): Promise<void> {
  if (!held.key) return Promise.resolve()
  held = { ...held, at: 0 }
  return load(held.key, lastIds, true)
}

function load(key: string, ids: readonly string[], again = false): Promise<void> {
  const token = heldToken()
  if (!RELAY_URL || !token) return Promise.resolve()
  lastIds = ids
  const current = reading
  if (current && held.key === key && !again) return current
  const run = readTeamsAsViewer(ids, RELAY_URL, token)
    .then((read) => put({ key, read, at: Date.now(), failed: false }))
    // A failure after a good read keeps the good one: a read that failed is not "in no team".
    .catch(() => put({ ...held, key, failed: held.key !== key || !held.read }))
    .finally(() => {
      if (reading === run) reading = null
    })
  reading = run
  return run
}

/** The Folders that are teams: every top-level Folder with state, the archived ones too (the page keeps their notice). */
export function teamFolders(folders: readonly FolderSummary[]): FolderSummary[] {
  const ids = new Set(topLevelFolders(folders.map((folder) => ({ ...folder, archived: undefined }))).map((folder) => folder.id))
  return folders.filter((folder) => ids.has(folder.id))
}

/** A team from its Folder and the facts read for it. Pure, so the rules are tested without a relay. */
export function teamOf(folder: FolderSummary, read: TeamsRead, viewer: string): Team {
  const roster = read.rosters[folder.id] ?? []
  const listing = read.listings[folder.id] ?? []
  const list: TeamsList | undefined = read.teamsList.state === 'present' ? read.teamsList.list : undefined
  const members = teamMembersOf(folder.id, roster)
  const isMember = members.some((member) => member.pubkey === viewer)
  const archived = !!folder.archived
  const chat = followingOf(
    { address: folder.channel ?? `39000::${folder.id}`, team: folder.id },
    viewer,
    { events: [], roster, listing, ...(list ? { teams: list } : {}), archived },
  )
  return {
    id: folder.id,
    name: folder.name ?? 'Untitled team',
    archived,
    company: !!folder.company,
    admins: folder.admins ?? [],
    members,
    isMember,
    isFollowing: !isMember && list?.teams[folder.id] !== undefined,
    listed: listedOf(listing),
    chat,
  }
}

/**
 * Every team the viewer can see, with who is in it, what it marks as its
 * spaces and whether the viewer follows it. `null` while the first read is
 * in flight or signed out; `failed` when it could not be read at all.
 */
export function useTeams({ read = true }: {
  /** Off: only what this tab already holds, never a read of its own — for a row or a dialog deciding what to offer. */
  read?: boolean
} = {}): { teams: Team[] | null; failed: boolean; reload: () => Promise<void> } {
  const { folders } = useFolders()
  const viewer = heldToken()?.pubkey
  const folderList = useMemo(() => (folders ? teamFolders(folders) : null), [folders])
  const ids = useMemo(() => (folderList ?? []).map((folder) => folder.id).sort(), [folderList])
  const key = viewer && folderList ? `${viewer}|${ids.join(',')}` : ''
  const state = useSyncExternalStore(subscribe, snapshot, snapshot)

  useEffect(() => {
    if (!key || !read) return
    if (held.key !== key || Date.now() - held.at > FRESH_MS) void load(key, ids)
  }, [key, ids, read])

  const reload = useCallback(async () => {
    if (!key) return
    held = { ...held, at: 0 }
    await load(key, ids, true)
  }, [key, ids])

  const teams = useMemo(() => {
    if (!folderList || !viewer || state.key !== key || !state.read) return null
    const read = state.read
    return folderList.map((folder) => teamOf(folder, read, viewer))
  }, [folderList, viewer, state, key])

  return { teams, failed: state.key === key && state.failed, reload }
}

/** The team that marks this file one of its spaces, from what this tab holds; `undefined` when none does, or none is held. */
export function spaceTeamOf(teams: readonly Team[] | null, address: string | undefined): Team | undefined {
  if (!teams || !address) return undefined
  return teams.find((team) => team.listed.some((entry) => entry.space && entry.address === address))
}

/**
 * Whether Move may be offered on a file: a space moves only by a member of its
 * team (SPEC §3.3; the relay refuses anyone else). Read from what the tab
 * holds: with nothing held it is offered, and a refusal says why.
 */
export function useMayMove(address: string | undefined): boolean {
  const { teams } = useTeams({ read: false })
  const team = spaceTeamOf(teams, address)
  return !team || team.isMember
}

/**
 * What a team holds outside any topic (Decided, 3 November: "Files" on its
 * page): the first level of its list, less its topics and every file some
 * topic lists. Its listing is the Folder's own read; the topics' entries are
 * one more. `null` while either is read; `failed` when one could not be.
 */
export function useTeamFiles(team: string | null | undefined): { files: ForeignObject[] | null; failed: boolean } {
  const { state } = useFolderContents(team)
  const candidates = useMemo(
    () =>
      typeof state === 'object' && 'files' in state
        ? state.files.filter((file) => !file.archived && file.address && Number(file.address.split(':')[0]) !== KIND_BARE_FILE)
        : null,
    [state],
  )
  const [listed, setListed] = useState<{ of: readonly ForeignObject[]; ids: Set<string> } | 'failed' | null>(null)
  useEffect(() => {
    const token = heldToken()
    if (!candidates || !RELAY_URL || !token) return
    let cancelled = false
    listedByTopicsAsViewer(candidates.map((file) => dOf(file.address!)), RELAY_URL, token)
      .then((ids) => !cancelled && setListed({ of: candidates, ids }))
      .catch(() => !cancelled && setListed('failed'))
    return () => {
      cancelled = true
    }
  }, [candidates])
  const failed = (typeof state === 'object' && 'failed' in state) || listed === 'failed'
  const files = candidates && listed && listed !== 'failed' && listed.of === candidates ? candidates.filter((file) => !listed.ids.has(dOf(file.address!))) : null
  return { files, failed }
}

const KIND_BARE_FILE = 30840
const dOf = (address: string) => address.split(':').slice(2).join(':')

/** A stream message as the shared rule reads one: a reply names its root, as NIP-10's marked `e` does. */
const asPlaceMessage = (message: StreamMessage) => ({
  id: message.id,
  pubkey: message.by,
  kind: 9,
  created_at: message.at,
  content: message.body,
  tags: message.root !== message.id ? [['e', message.root, '', 'root']] : [],
})

/** A team chat's messages from a Folder's channel stream: those about no file (§11.1's general stream). */
export const chatMessagesOf = (messages: readonly StreamMessage[]) => messages.filter((message) => message.about.length === 0)

/** Whether a team's chat has something new for `viewer` in its channel's stream (§11.8): only ever a member's. */
export function chatHasUnread(team: Team, stream: readonly StreamMessage[], merged: Readonly<Record<string, number>>, viewer: string): boolean {
  if (!team.isMember) return false
  const messages = chatMessagesOf(stream).map(asPlaceMessage)
  return unreadOnPlace(messages, merged, { stream: team.id, me: viewer, following: team.chat }).length > 0
}

/**
 * Whether each team's chat has something new for the viewer, by the shared
 * rule (§11.8): at Important, a new conversation, and a reply in one they are
 * in; a mention always. Only a member's chat can light — nobody else is in it.
 * The messages are the tab's channel store's, already read for the Folders'
 * own dots: no read of its own. A team not judged yet is absent.
 */
export function useTeamChatUnread(teams: readonly Team[] | null): Record<string, boolean> {
  const viewer = heldToken()?.pubkey
  const ids = useMemo(() => (teams ?? []).filter((team) => team.isMember).map((team) => team.id), [teams])
  const { streams } = useChannelStreams(ids)
  const { merged, ready } = useReadFrontier()
  return useMemo(() => {
    const out: Record<string, boolean> = {}
    if (!viewer || !ready) return out
    for (const team of teams ?? []) {
      const stream = team.isMember ? streams[team.id] : []
      if (stream) out[team.id] = chatHasUnread(team, stream, merged, viewer)
    }
    return out
  }, [teams, streams, merged, ready, viewer])
}
