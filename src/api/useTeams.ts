import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { followingOf, teamMembersOf, unreadOnPlace, type Following, type TeamMember, type TeamsList } from '@estiva-app/conversation'
import { KIND_BARE_FILE, topLevelFolders, type FolderSummary, type ForeignObject } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'
import { heldToken } from '@/auth/heldSession'
import type { StreamMessage } from '@/nostr/channelStreams'
import { dOfAddress, entryNames, listedByTopicsAsViewer, listedOf, readTeamsAsViewer, type ListedEntry, type TeamsRead } from '@/nostr/teams'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { RELAY_URL } from './relayUrl'
import { useChannelStreams } from './useChannelStreams'
import { useFolderContents, useFolders } from './useFolderContents'
import { useReadableTopics } from './useTopicsColumn'
import { explainUnread, newestFirst, type RowNewsItem } from './rowNews'

export { entryNames, type ListedEntry }

/** One team, as Peek's Teams draws it (TEA-5). */
export interface Team {
  /** The Folder's uuid: the team's `h`, and its chat's read-state context. */
  id: string
  name: string
  archived: boolean
  /** The Company team (§3.4): nobody leaves it. */
  company: boolean
  /** Private (NIP-29): joined only by being added, never by Join. */
  private: boolean
  /** Owners and admins: who may rename and archive it. */
  admins: readonly string[]
  /** Everyone its roster lists, in the order they joined. Agents among them; the page draws them apart. */
  members: readonly TeamMember[]
  isMember: boolean
  /** The viewer follows it, privately (§11.8). Never true of a team they are in: being in it says more. */
  isFollowing: boolean
  /** What its list holds, in its order, each with whether it is one of its spaces. */
  listed: readonly ListedEntry[]
  /** Its chat's address: the team's own `39000`, as a level on the chat names it. */
  chatAddress: string
  /**
   * How the viewer is in its chat (`a-teams-chat-is-followed-like-a-space`):
   * by the team's default for a member, at the level they chose on it, or
   * added to it — the chat's changes naming them are in the teams read.
   */
  chat: Following
  /** What the shared fold reads for a space's default (TEA-6): its roster, its list, and the viewer's teams list. */
  facts?: { roster: readonly SignedEvent[]; listing: readonly SignedEvent[]; teams?: TeamsList }
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
let lastChats: readonly string[] = []
/** Which read was started last: only it may put, so a slower, older read never lands over a newer one. */
let started = 0

/** Forget the held teams: one test's read is not the next one's. */
export function resetTeamsForTests(): void {
  held = { key: '', at: 0, failed: false }
  reading = null
  lastIds = []
  lastChats = []
}

/** Read the teams again now: after a join, leave, add, follow or mark, so the change shows where it was made. */
export function reloadTeamsOnScreen(): Promise<void> {
  if (!held.key) return Promise.resolve()
  held = { ...held, at: 0 }
  return load(held.key, lastIds, lastChats, true)
}

function load(key: string, ids: readonly string[], chats: readonly string[], again = false): Promise<void> {
  const token = heldToken()
  if (!RELAY_URL || !token) return Promise.resolve()
  lastIds = ids
  lastChats = chats
  const current = reading
  if (current && held.key === key && !again) return current
  const mine = ++started
  const run = readTeamsAsViewer(ids, chats, RELAY_URL, token)
    .then((read) => {
      if (mine === started) put({ key, read, at: Date.now(), failed: false })
    })
    // A failure after a good read keeps the good one: a read that failed is not "in no team".
    .catch(() => {
      if (mine === started) put({ ...held, key, failed: held.key !== key || !held.read })
    })
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

/** A team's chat's address: its Folder's channel. */
const chatAddressOf = (folder: FolderSummary) => folder.channel ?? `39000::${folder.id}`

/** A team from its Folder and the facts read for it. Pure, so the rules are tested without a relay. */
export function teamOf(folder: FolderSummary, read: TeamsRead, viewer: string): Team {
  const roster = read.rosters[folder.id] ?? []
  const listing = read.listings[folder.id] ?? []
  const list: TeamsList | undefined = read.teamsList.state === 'present' ? read.teamsList.list : undefined
  const members = teamMembersOf(folder.id, roster)
  const isMember = members.some((member) => member.pubkey === viewer)
  const archived = !!folder.archived
  const chatAddress = chatAddressOf(folder)
  const chat = followingOf(
    { address: chatAddress, team: folder.id },
    viewer,
    { events: read.changes?.[folder.id] ?? [], roster, listing, ...(list ? { teams: list } : {}), archived },
  )
  return {
    id: folder.id,
    name: folder.name ?? 'Untitled team',
    archived,
    company: !!folder.company,
    private: !!folder.private,
    admins: folder.admins ?? [],
    members,
    isMember,
    isFollowing: !isMember && list?.teams[folder.id] !== undefined,
    listed: listedOf(listing),
    chatAddress,
    chat,
    facts: { roster, listing, ...(list ? { teams: list } : {}) },
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
  const chats = useMemo(() => (folderList ?? []).map(chatAddressOf).sort(), [folderList])
  const key = viewer && folderList ? `${viewer}|${ids.join(',')}` : ''
  const state = useSyncExternalStore(subscribe, snapshot, snapshot)

  useEffect(() => {
    if (!key || !read) return
    if (held.key !== key || Date.now() - held.at > FRESH_MS) void load(key, ids, chats)
  }, [key, ids, chats, read])

  const reload = useCallback(async () => {
    if (!key) return
    held = { ...held, at: 0 }
    await load(key, ids, chats, true)
  }, [key, ids, chats])

  const teams = useMemo(() => {
    if (!folderList || !viewer || state.key !== key || !state.read) return null
    const read = state.read
    return folderList.map((folder) => teamOf(folder, read, viewer))
  }, [folderList, viewer, state, key])

  return { teams, failed: state.key === key && state.failed, reload }
}

/** The team whose list names this file, and whether as one of its spaces; `undefined` when none does, or none is held. */
export function listingOf(teams: readonly Team[] | null, address: string | undefined): { team: Team; space: boolean } | undefined {
  if (!teams || !address) return undefined
  for (const team of teams) {
    const entry = team.listed.find((candidate) => entryNames(candidate, address))
    if (entry) return { team, space: entry.space }
  }
  return undefined
}

/** The team that marks this file one of its spaces, from what this tab holds; `undefined` when none does, or none is held. */
export function spaceTeamOf(teams: readonly Team[] | null, address: string | undefined): Team | undefined {
  if (!teams || !address) return undefined
  return teams.find((team) => team.listed.some((entry) => entry.space && entryNames(entry, address)))
}

/**
 * Every active topic this viewer can read, by address: a team's list names
 * them, and this draws their titles. Only the topics: never the files they
 * list, whose read is the Topics screen's heaviest and which no team row draws.
 */
export function useTeamTopics(): { topics: ReadonlyMap<string, ForeignObject>; loading: boolean; signedOut: boolean } {
  const { topics: live, loading, signedOut } = useReadableTopics()
  const topics = useMemo(() => new Map(live.flatMap((topic) => (topic.address ? [[topic.address, topic] as const] : []))), [live])
  return { topics, loading, signedOut }
}

/** A team's spaces and the topics it leads, in its list's order, from the topics this viewer can read; archived ones left out. */
export function teamPlaces(team: Team, topics: ReadonlyMap<string, ForeignObject>): { spaces: ForeignObject[]; led: ForeignObject[] } {
  const byId = new Map([...topics].map(([address, topic]) => [dOfAddress(address), topic]))
  const of = (space: boolean) =>
    team.listed
      .filter((entry) => entry.space === space)
      .flatMap((entry) => ('address' in entry ? topics.get(entry.address) : byId.get(entry.id)) ?? [])
      .filter((topic) => !topic.archived)
  return { spaces: of(true), led: of(false) }
}

/**
 * Whether Move may be offered on a row's file: a space moves only by a member
 * of its team (SPEC §3.3; the relay refuses anyone else). Read from what the
 * tab holds, never a read per row: with nothing held it is offered, and a
 * refusal says why.
 */
export function useMayMove(address: string | undefined): boolean {
  return mayMove(useTeams({ read: false }).teams, address)
}

/**
 * Whether a topic's files may be added, removed and arranged from here
 * (TOPI-5: anyone who can add a file can arrange). The relay takes a change
 * in a team's Folder from a member, and from anyone in one that is not
 * private. Read from what the tab holds: with the team not held it is
 * offered, and a refusal says why.
 */
export function mayChangeTopicIn(teams: readonly Team[] | null, folder: string | null | undefined): boolean {
  const team = folder ? teams?.find((t) => t.id === folder) : undefined
  return !team || team.isMember || !team.private
}

/** `useMayMove`'s rule, from the teams handed to it. */
export function mayMove(teams: readonly Team[] | null, address: string | undefined): boolean {
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

const dOf = dOfAddress

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

/** Whether a team's chat has something new for `viewer` in its channel's stream (§11.8): only for someone in it. */
export function chatHasUnread(team: Team, stream: readonly StreamMessage[], merged: Readonly<Record<string, number>>, viewer: string): boolean {
  return chatNews(team, stream, merged, viewer).length > 0
}

/** What is new for `viewer` in a team's chat, a line each with its reason and words (ACT-3), newest first: the messages its dot lights for. */
export function chatNews(team: Team, stream: readonly StreamMessage[], merged: Readonly<Record<string, number>>, viewer: string): RowNewsItem[] {
  if (!team.chat.in) return []
  const chat = chatMessagesOf(stream)
  const messages = chat.map(asPlaceMessage)
  const unread = unreadOnPlace(messages, merged, { stream: team.id, me: viewer, following: team.chat })
  const byId = new Map(chat.map((m) => [m.id, m]))
  return newestFirst(explainUnread(messages, unread, viewer, (m) => ({ root: byId.get(m.id)?.root ?? m.id, words: m.content })))
}

/**
 * Whether each team's chat has something new for the viewer, by the shared
 * rule (§11.8): at Important, a new conversation, and a reply in one they are
 * in; at All every message since they chose it; a mention always. Only a chat
 * the viewer is in can light: a member's by default, or one they chose a level
 * on or were added to. The messages are the tab's channel store's, already
 * read for the Folders' own dots: no read of its own. A team not judged yet is
 * absent.
 */
export function useTeamChatUnread(teams: readonly Team[] | null): Record<string, boolean> {
  return useTeamChatNews(teams).unread
}

/** {@link useTeamChatUnread}, with each lit chat's card lines (ACT-3): the same messages, read once. */
export function useTeamChatNews(teams: readonly Team[] | null): { unread: Record<string, boolean>; news: Record<string, RowNewsItem[]> } {
  const viewer = heldToken()?.pubkey
  const ids = useMemo(() => (teams ?? []).filter((team) => team.chat.in).map((team) => team.id), [teams])
  const { streams } = useChannelStreams(ids)
  const { merged, ready } = useReadFrontier()
  return useMemo(() => {
    const unread: Record<string, boolean> = {}
    const news: Record<string, RowNewsItem[]> = {}
    if (!viewer || !ready) return { unread, news }
    for (const team of teams ?? []) {
      const stream = team.chat.in ? streams[team.id] : []
      if (!stream) continue
      const lines = chatNews(team, stream, merged, viewer)
      unread[team.id] = lines.length > 0
      if (lines.length > 0) news[team.id] = lines
    }
    return { unread, news }
  }, [teams, streams, merged, ready, viewer])
}
