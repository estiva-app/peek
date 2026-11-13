import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { IconUsers } from '@tabler/icons-react'
import { EmptyState, NavItem, NavTree, SectionHeader, SkeletonList, type UnreadDotTone } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import { teamPlaces, useConversationBadges, useLeavesTopic, usePeekActions, useReactionsSeenOnClose, useTeamChatNews, useTeams, useTeamTopics, type RowNewsItem, type Team } from '@/api'
import { RowNewsCard } from '@/components/RowNewsCard'
import { TreeRow } from '@/components/views/FileTreeView'
import type { FileControl } from '@/components/views/useFileControls'
import type { TreeShow } from '@/components/views/treeFilter'
import { useToast } from '@/lib/toast'

/** A team's chat: its own path beside the team's page (TEA-5). */
export const teamChatPath = (team: string) => `/app/teams/${team}/chat`

/**
 * A team's chat row is called by the team, as the prototype draws it ("engineering" for Engineering).
 * The Company team's chat is the company's general conversation (SPEC §3.4), so it reads "general"
 * whatever the team is named (TEA-1's story; TEA-7).
 */
export const chatLabel = (team: Team) => (team.company ? 'general' : team.name.toLowerCase())

/**
 * Peek's Teams (TEA-5): the teams you are in, the ones you follow, and the
 * rest, as the approved prototype draws them (Miky, 2 November). A team's
 * section holds its chat (members only), its spaces, then the topics it
 * leads, with no label between them; another team is its name alone. A team's
 * name opens its page, where Join, Follow, Leave and Add are.
 *
 * Spaces and topics keep today's dot until the follow switch ships (TEA-6), and
 * each draws its plain place icon (Decided, 3 November). The chat's dot is the
 * shared rule's (§11.8).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-team-holds-three-kinds-of-place-and-add-puts-you-in-one.md
 */
export function TeamsColumn({
  show,
  selectedRef,
  openTeam,
  chatOpen = false,
  onControl,
}: {
  show: TreeShow
  /** `ref` of the open file: its row is current. */
  selectedRef?: string
  /** The team whose page or chat is open. */
  openTeam?: string | null
  /** The open team's chat is what is open. */
  chatOpen?: boolean
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  const { teams, failed } = useTeams()
  const { unread: chatUnread, news: chatNews, tones: chatTones } = useTeamChatNews(teams)
  const { topics, loading, signedOut } = useTeamTopics()
  const { markSpace } = usePeekActions()
  const { showToast } = useToast()
  const leaves = useLeavesTopic(teams)

  const drawn = useMemo(() => (teams ? [...topics.values()] : undefined), [teams, topics])
  // A reaction to your message turns a space or a topic orange too (ACT-7).
  const { unread, news, tones } = useConversationBadges(drawn, { reactions: true })

  if (signedOut) return <EmptyState scope="section" message="Sign in to see teams." />
  if (failed) return <EmptyState scope="section" message="Couldn’t load your teams. Reload to try again." />
  if (!teams || loading) return <SkeletonList />

  const mark = async (team: Team, topic: ForeignObject, space: boolean) => {
    if (!topic.address) return
    const result = await markSpace(team.id, topic.address, space)
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
  }

  return (
    <TeamsColumnView
      teams={teams.filter((team) => !team.archived)}
      topics={topics}
      chatUnread={chatUnread}
      chatNews={chatNews}
      chatTones={chatTones}
      unread={unread}
      news={news}
      tones={tones}
      show={show}
      selectedRef={selectedRef}
      openTeam={openTeam}
      chatOpen={chatOpen}
      onControl={onControl}
      onMarkSpace={mark}
      leavesOf={leaves}
    />
  )
}

/** A team's chat row: its dot, orange when reactions to you are all that is new (ACT-7), and its card. */
function TeamChatRow({ team, unread, news, tone, active }: { team: Team; unread: boolean; news?: readonly RowNewsItem[]; tone?: UnreadDotTone; active: boolean }) {
  const lines = unread ? news : undefined
  // Leaving its card, or opening it on a touch screen, sees the reactions to you it listed.
  const reactionsSeen = useReactionsSeenOnClose(lines)
  return (
    <NavItem
      href={teamChatPath(team.id)}
      label={chatLabel(team)}
      icon={<IconUsers size={16} stroke={1.5} aria-hidden />}
      unread={unread}
      unreadTone={unread ? tone : undefined}
      preview={lines?.length ? <RowNewsCard items={lines} placeHref={teamChatPath(team.id)} place="chat" /> : undefined}
      onPreviewOpenChange={reactionsSeen.onPreviewOpenChange}
      onClick={reactionsSeen.onOpenRow}
      active={active}
    />
  )
}

/** The column's body, handed what it draws: the part a story or a test shows. */
export function TeamsColumnView({
  teams,
  topics,
  chatUnread,
  chatNews,
  chatTones,
  unread,
  news,
  tones,
  show = 'all',
  selectedRef,
  openTeam,
  chatOpen = false,
  onControl,
  onMarkSpace,
  leavesOf,
}: {
  teams: readonly Team[]
  /** The topics this viewer can read, by address. */
  topics: ReadonlyMap<string, ForeignObject>
  chatUnread: Record<string, boolean>
  /** What lit each lit chat and row (ACT-3), for their cards. */
  chatNews?: Record<string, readonly RowNewsItem[]>
  /** Each lit chat's dot colour (ACT-7). */
  chatTones?: Record<string, UnreadDotTone>
  /** Today's dot on a topic's row, by `ref`. */
  unread: Record<string, boolean>
  news?: Record<string, readonly RowNewsItem[]>
  /** Each lit row's dot colour (ACT-7). */
  tones?: Record<string, UnreadDotTone>
  show?: TreeShow
  selectedRef?: string
  openTeam?: string | null
  chatOpen?: boolean
  onControl?: (control: FileControl, file: ForeignObject) => void
  onMarkSpace?: (team: Team, topic: ForeignObject, space: boolean) => void
  /** The row offers Leave (`useLeavesTopic`): wherever the viewer hears from it, a team's default included. */
  leavesOf?: (topic: ForeignObject) => boolean
}) {
  const byName = (a: Team, b: Team) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  const mine = teams.filter((team) => team.isMember).sort(byName)
  const followed = teams.filter((team) => !team.isMember && team.isFollowing).sort(byName)
  const others = teams.filter((team) => !team.isMember && !team.isFollowing).sort(byName)

  // Its chat, its spaces, then the topics it leads; under Unread only what lights, and the open one.
  const section = (team: Team) => {
    const shown = (topic: ForeignObject) => show === 'all' || unread[topic.ref] === true || topic.ref === selectedRef
    const places = teamPlaces(team, topics)
    const spaces = places.spaces.filter(shown)
    const led = places.led.filter(shown)
    const chatOpenHere = chatOpen && openTeam === team.id
    const chat = team.isMember && (show === 'all' || chatUnread[team.id] === true || chatOpenHere)
    if (show !== 'all' && !chat && spaces.length + led.length === 0 && openTeam !== team.id) return null
    const row = (topic: ForeignObject, space: boolean) => (
      <TreeRow
        key={topic.ref}
        file={topic}
        unread={unread}
        news={news}
        tones={tones}
        selectedRef={selectedRef}
        onControl={onControl}
        nested
        leaves={leavesOf?.(topic) ?? false}
        space={team.isMember && onMarkSpace ? { action: space ? 'unmark' : 'mark', onToggle: () => onMarkSpace(team, topic, !space) } : undefined}
      />
    )
    return (
      <div key={team.id} className="flex flex-col gap-0.5 pb-2">
        <SectionHeader
          title={team.name}
          look="quiet"
          // A link, not a button: the team's page is a place, and Cmd-click opens it in a new tab.
          render={<Link to={`/app/teams/${team.id}`} aria-label={`Open ${team.name}`} />}
        />
        {chat && (
          <TeamChatRow
            team={team}
            unread={chatUnread[team.id] === true}
            news={chatNews?.[team.id]}
            tone={chatTones?.[team.id]}
            active={chatOpenHere}
          />
        )}
        {spaces.map((topic) => row(topic, true))}
        {led.map((topic) => row(topic, false))}
        {show === 'all' && spaces.length + led.length === 0 && <EmptyState scope="section" message="No spaces or topics yet" />}
      </div>
    )
  }

  const group = (title: string, body: ReactNode) => (
    <div className="flex flex-col pb-2">
      <SectionHeader title={title} />
      {body}
    </div>
  )
  const mineSections = mine.map(section).filter(Boolean)
  const followedSections = followed.map(section).filter(Boolean)
  const otherRows = show === 'all' ? others : others.filter((team) => team.id === openTeam)

  if (teams.length === 0) return <EmptyState scope="section" message="No teams yet." />
  if (mineSections.length + followedSections.length + otherRows.length === 0) return <EmptyState scope="section" message="Nothing unread." />

  return (
    <NavTree selected={selectedRef}>
      {mineSections.length > 0 && group('My teams', mineSections)}
      {followedSections.length > 0 && group('Following', followedSections)}
      {otherRows.length > 0 &&
        group(
          'Other teams',
          <div className="flex flex-col gap-0.5">
            {otherRows.map((team) => (
              <NavItem key={team.id} href={`/app/teams/${team.id}`} label={team.name} active={openTeam === team.id && !chatOpen} />
            ))}
          </div>,
        )}
    </NavTree>
  )
}
