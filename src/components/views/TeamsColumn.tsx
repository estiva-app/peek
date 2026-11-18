import { useMemo, useState, type ReactNode } from 'react'
import { IconFolder, IconHash, IconPlus, IconTarget, IconUsers } from '@tabler/icons-react'
import { CollapsibleSection, EmptyState, NavItem, NavTree, shortcutLabel, SkeletonList, SkeletonRow, UnreadDot, type UnreadDotTone } from '@estiva-app/ui'
import { KIND_BARE_FILE, type ForeignObject } from '@estiva-app/interop'
import {
  teamPlaces,
  useConversationBadges,
  useLeavesTopic,
  usePeekActions,
  useReactionsSeenOnClose,
  useTeamChatNews,
  useTeamFiles,
  useTeams,
  useTeamTopics,
  type RowNewsItem,
  type Team,
} from '@/api'
import { RowNewsCard } from '@/components/RowNewsCard'
import { TreeRow } from '@/components/views/FileTreeView'
import { TopicMenuItems } from '@/components/ui/TopicMoreMenu'
import { useToggleOpenWork } from '@/components/views/useToggleOpenWork'
import { useNotFollowing } from '@/components/views/useNotFollowing'
import { OPEN_WORK_KEY } from '@/lib/openWorkKey'
import type { FileControl } from '@/components/views/useFileControls'
import type { TreeShow } from '@/components/views/treeFilter'
import { useToast } from '@/lib/toast'
import { useReportFailure } from '@/lib/failureReports'

/** A team's chat: its own path beside the team's page (TEA-5). */
export const teamChatPath = (team: string) => `/app/teams/${team}/chat`

/**
 * A team's chat row is called by the team, as the prototype draws it ("engineering" for Engineering).
 * The Company team's chat is the company's general conversation (SPEC §3.4), so it reads "general"
 * whatever the team is named (TEA-1's story; TEA-7). Kept by Katerina, 16 November (Q-17).
 */
export const chatLabel = (team: Team) => (team.company ? 'general' : team.name.toLowerCase())

const ICON = { size: 16, stroke: 1.5 } as const

/**
 * Peek's Teams, as the navigation prototype draws it (Katerina, 16 November; the decisions' step 3): the kit's tree as
 * Ship's and Leaf's sidebars use it. Every item is a row that opens its page; its icon turns into the arrow that alone
 * folds the rows under it.
 *
 * - The teams you are in and the ones you follow, together, the Company team first, then A–Z, with no label over them
 *   (Q-14, T-08). Each wears the team icon, opens its page, starts unfolded, and offers + (New topic in it) to its
 *   members.
 * - Under a team: its chat (members only), then its topics (`#`, today's spaces), then an Initiatives fold of the ones it
 *   leads (◎, today's topics: today's order, each kind with its own icon; Katerina, 16 November, T-14 changed; in a
 *   fold as its Files are, shut until opened or until one inside is opened, 17 November), then a Files fold
 *   of its projects and documents, whichever initiative lists them, shut until opened or until a file inside it is
 *   opened. An initiative is in Initiatives too; opened from here, its page keeps this column.
 * - The other teams, in one fold drawn as a row among rows, with its count, shut unless the open team is inside it.
 *
 * Rows show their kind, never how you follow them; only Not following shows, while the row is pointed at (Q-22).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-team-holds-three-kinds-of-place-and-add-puts-you-in-one.md
 */
export function TeamsColumn({
  show,
  selectedRef,
  selectedParent,
  openTeam,
  chatOpen = false,
  onControl,
  onStartTopic,
}: {
  show: TreeShow
  /** `ref` of the open file: its row is current. */
  selectedRef?: string
  /** The address the open file names as its parent: a Ship issue's project, which opens to show it. */
  selectedParent?: string | null
  /** The team whose page, chat or file is open. */
  openTeam?: string | null
  /** The open team's chat is what is open. */
  chatOpen?: boolean
  onControl?: (control: FileControl, file: ForeignObject) => void
  /** A team's +: Start a topic, that team chosen (Q-16). */
  onStartTopic?: (team: Team) => void
}) {
  const { teams, failed } = useTeams()
  useReportFailure(failed ? 'not-loaded' : undefined)
  const { unread: chatUnread, news: chatNews, tones: chatTones } = useTeamChatNews(teams, { reactions: true })
  const { topics, loading, signedOut } = useTeamTopics()
  const { markSpace } = usePeekActions()
  const { showToast } = useToast()
  const leaves = useLeavesTopic(teams)
  // Not following: the one level a row shows (Q-22), as the team's page shows it too.
  const notFollowing = useNotFollowing()
  // A team's chat in Open work, by its address, as its page's button does it (B-14), with the same toast and Undo.
  const openWork = useToggleOpenWork()

  const drawn = useMemo(() => (teams ? [...topics.values()] : undefined), [teams, topics])
  // A reaction to your message turns a topic orange too (ACT-7).
  const { unread, news, tones } = useConversationBadges(drawn, { reactions: true })

  if (signedOut) return <EmptyState scope="section" message="Sign in to see teams." />
  if (failed) return <EmptyState scope="section" message="Couldn’t load your teams. Reload to try again." />
  if (!teams || loading) return <SkeletonList />

  /*
    Make it an initiative, or a topic (T-31): today's space mark in the new words. No warning first (Q-24): a toast
    says what changed, with Undo (Q-10).
  */
  const mark = async (team: Team, topic: ForeignObject, space: boolean) => {
    if (!topic.address) return
    const title = topic.slots.title?.value ?? 'This topic'
    const result = await markSpace(team.id, topic.address, space)
    if (!result.ok) return showToast({ label: result.reason, type: 'error', failure: 'not-saved' })
    showToast({
      label: space
        ? `${title} is a topic now: it shows under ${team.name} in Teams.`
        : `${title} is an initiative now: it shows under Initiatives for everyone in it.`,
      type: 'success',
      actionLabel: 'Undo',
      onAction: () => void markSpace(team.id, topic.address!, !space).then((undone) => !undone.ok && showToast({ label: undone.reason, type: 'error', failure: 'not-saved' })),
    })
  }

  // A chat's link, as the address bar shows it: said in a toast, as a file's Copy link is.
  const copyChatLink = (team: Team) => {
    const link = new URL(teamChatPath(team.id), window.location.origin).href
    if (!navigator.clipboard) return void window.prompt('Copy this link:', link)
    void navigator.clipboard.writeText(link).then(
      () => showToast({ label: 'Link copied', type: 'success' }),
      () => void window.prompt('Copy this link:', link),
    )
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
      selectedParent={selectedParent}
      openTeam={openTeam}
      chatOpen={chatOpen}
      onControl={onControl}
      onMarkSpace={mark}
      leavesOf={leaves}
      notFollowingOf={notFollowing}
      onStartTopic={onStartTopic}
      onCopyChatLink={copyChatLink}
      chatInOpenWork={(team) => openWork.has(team.chatAddress)}
      onToggleChatOpenWork={(team) => openWork.toggle(team.chatAddress)}
    />
  )
}

/** A team's chat row: `#` and its name, its dot, orange when reactions to you are all that is new (ACT-7), and its card. */
function TeamChatRow({
  team,
  unread,
  news,
  tone,
  active,
  onCopyLink,
  openWork,
}: {
  team: Team
  unread: boolean
  news?: readonly RowNewsItem[]
  tone?: UnreadDotTone
  active: boolean
  onCopyLink?: () => void
  /** Its Open work item: Add, or Remove once it is in Open work. */
  openWork?: { action: 'add' | 'remove'; onToggle: () => void }
}) {
  const lines = unread ? news : undefined
  // Leaving its card, or opening it on a touch screen, sees the reactions to you it listed.
  const reactionsSeen = useReactionsSeenOnClose(lines)
  return (
    <NavItem
      href={teamChatPath(team.id)}
      label={chatLabel(team)}
      // A team's chat wears `#`, as its topics do (Katerina, 16 November: one icon per kind).
      icon={<IconHash {...ICON} aria-hidden />}
      unread={unread}
      unreadTone={unread ? tone : undefined}
      preview={lines?.length ? <RowNewsCard items={lines} placeHref={teamChatPath(team.id)} place="chat" /> : undefined}
      onPreviewOpenChange={reactionsSeen.onPreviewOpenChange}
      onClick={reactionsSeen.onOpenRow}
      active={active}
      /*
        Its ⋮: Add to Open work first, as a topic's row has it, then Copy link (Katerina, 16 November, Q-25: Copy link;
        17 November: Open work too, now that Open work holds a team's chat, B-14). Its key only on the open chat's row.
      */
      {...(onCopyLink || openWork
        ? {
            menu: (
              <TopicMenuItems
                openWorkAction={openWork?.action}
                onToggleOpenWork={openWork?.onToggle}
                openWorkShortcut={active && openWork ? shortcutLabel(OPEN_WORK_KEY) : undefined}
                onCopyLink={onCopyLink}
              />
            ),
            menuLabel: `More options for ${chatLabel(team)}`,
          }
        : {})}
    />
  )
}

/** Whether a team's list names a file that is not a place: a project or a document, which its Files fold holds. */
const holdsFiles = (team: Team) => team.listed.some((entry) => 'address' in entry && Number(entry.address.split(':')[0]) !== KIND_BARE_FILE)

/**
 * A team's Files (T-16): the kit's fold drawn as a row among rows. The whole row folds and opens no page; it starts
 * shut (Katerina, 16 November: "collapsed by default"), opens itself for a file opened inside it, and reads the team's
 * files only once it is open (B-07).
 */
function TeamFilesFold({
  team,
  holdsOpen,
  selectedRef,
  selectedParent,
  unreadOnly,
  onControl,
  renderFiles,
}: {
  team: Team
  /** The open file is in this team and is not one of its places: the fold opens for it. */
  holdsOpen: boolean
  selectedRef?: string
  selectedParent?: string | null
  unreadOnly: boolean
  onControl?: (control: FileControl, file: ForeignObject) => void
  renderFiles?: (team: Team) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <CollapsibleSection
      look="row"
      title="Files"
      icon={<IconFolder {...ICON} aria-hidden />}
      open={open}
      onOpenChange={setOpen}
      {...(holdsOpen && selectedRef ? { openFor: selectedRef } : {})}
      contentClassName="gap-0.5"
    >
      {open &&
        (renderFiles ? (
          renderFiles(team)
        ) : (
          <TeamFileRows team={team} selectedRef={selectedRef} selectedParent={selectedParent} unreadOnly={unreadOnly} onControl={onControl} />
        ))}
    </CollapsibleSection>
  )
}

/**
 * A team's initiatives in one fold, as its Files are (Katerina, 17 November: "the initiatives should still be in their
 * expandable item"): shut until opened, or until one inside is opened. Under Unread it starts open: only the lit ones
 * are in it. Shut, it wears the dot of what is new inside, which its rows show once it is open.
 */
function TeamInitiativesFold({
  holdsOpen,
  selectedRef,
  unreadOnly,
  litTones,
  children,
}: {
  /** The open file is one of these initiatives: the fold opens for it. */
  holdsOpen: boolean
  selectedRef?: string
  unreadOnly: boolean
  /** Each lit initiative's dot colour, one entry per lit row (ACT-7). */
  litTones: readonly (UnreadDotTone | undefined)[]
  children: ReactNode
}) {
  const [open, setOpen] = useState(unreadOnly)
  // One colour when every lit row has it (orange: only reactions to you), else the plain dot.
  const tone = litTones.length > 0 && litTones.every((one) => one === litTones[0]) ? litTones[0] : undefined
  return (
    <CollapsibleSection
      look="row"
      title="Initiatives"
      icon={<IconTarget {...ICON} aria-hidden />}
      open={open}
      onOpenChange={setOpen}
      {...(holdsOpen && selectedRef ? { openFor: selectedRef } : {})}
      {...(!open && litTones.length > 0 ? { trailing: <UnreadDot {...(tone ? { tone } : {})} /> } : {})}
      contentClassName="gap-0.5"
    >
      {children}
    </CollapsibleSection>
  )
}

/** The rows in a team's Files fold: each file with its kind's icon; a project folds its issues, open for the open one. */
function TeamFileRows({
  team,
  selectedRef,
  selectedParent,
  unreadOnly,
  onControl,
}: {
  team: Team
  selectedRef?: string
  selectedParent?: string | null
  unreadOnly: boolean
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  const { files, failed } = useTeamFiles(team.id)
  useReportFailure(failed ? 'not-loaded' : undefined)
  if (failed) return <EmptyState scope="rows" message="Couldn’t load its files. Reload to try again." />
  if (!files) return <SkeletonRow />
  // Under Unread, only the open file (or the project holding it): files have no dot of their own.
  const shown = unreadOnly ? files.filter((file) => file.ref === selectedRef || (!!selectedParent && file.address === selectedParent)) : files
  if (shown.length === 0) return <EmptyState scope="rows" message="No files yet." />
  const parent = selectedParent ? shown.find((file) => file.address === selectedParent) : undefined
  return (
    <>
      {shown.map((file) => (
        <TreeRow key={file.ref} file={file} selectedRef={selectedRef} {...(parent ? { expand: [parent.ref] } : {})} onControl={onControl} />
      ))}
    </>
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
  selectedParent,
  openTeam,
  chatOpen = false,
  onControl,
  onMarkSpace,
  leavesOf,
  notFollowingOf,
  onStartTopic,
  onCopyChatLink,
  chatInOpenWork,
  onToggleChatOpenWork,
  renderFiles,
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
  selectedParent?: string | null
  openTeam?: string | null
  chatOpen?: boolean
  onControl?: (control: FileControl, file: ForeignObject) => void
  onMarkSpace?: (team: Team, topic: ForeignObject, space: boolean) => void
  /** The row offers Leave (`useLeavesTopic`): wherever the viewer hears from it, a team's default included. */
  leavesOf?: (topic: ForeignObject) => boolean
  /** You picked Not following on this topic: its row says so while pointed at. */
  notFollowingOf?: (team: Team, topic: ForeignObject) => boolean
  onStartTopic?: (team: Team) => void
  /** A team chat's Copy link (Q-25). */
  onCopyChatLink?: (team: Team) => void
  /** Whether a team's chat is in Open work. */
  chatInOpenWork?: (team: Team) => boolean
  /** A team chat's Add to Open work, or Remove (Katerina, 17 November): offered while you are in the chat, as its page's button is. */
  onToggleChatOpenWork?: (team: Team) => void
  /** The rows of a team's Files fold, for a story or a test: by default the fold reads them once it opens. */
  renderFiles?: (team: Team) => ReactNode
}) {
  const unreadOnly = show !== 'all'
  const byName = (a: Team, b: Team) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  // Yours and the ones you follow together, the Company team first (Q-14); the rest in one fold.
  const yours = teams.filter((team) => team.isMember || team.isFollowing).sort((a, b) => Number(b.company) - Number(a.company) || byName(a, b))
  const others = teams.filter((team) => !team.isMember && !team.isFollowing).sort(byName)
  // A team's page alone is open: no chat, no file of its.
  const teamPageOpen = (team: Team) => openTeam === team.id && !chatOpen && !selectedRef

  const section = (team: Team) => {
    // Under Unread only what lights, and the open one (today's).
    const shown = (topic: ForeignObject) => !unreadOnly || unread[topic.ref] === true || topic.ref === selectedRef
    const { spaces, led } = teamPlaces(team, topics)
    const topicsShown = spaces.filter(shown)
    const initiativesShown = led.filter(shown)
    const chatOpenHere = chatOpen && openTeam === team.id
    const chat = team.isMember && (!unreadOnly || chatUnread[team.id] === true || chatOpenHere)
    /*
      The open file is in this team and is none of its places, a topic or an initiative: its Files fold opens for it. A
      place never does, by its kind, not only by the team's list: a topic just started is open before the list names
      it, and Files flashed open and empty for it until the list was read again (Katerina, 17 November).
    */
    const openIsPlace = !!selectedRef && Number(selectedRef.split(':')[0]) === KIND_BARE_FILE
    const fileOpenHere = openTeam === team.id && !!selectedRef && !chatOpen && !openIsPlace && ![...spaces, ...led].some((topic) => topic.ref === selectedRef)
    const files = holdsFiles(team) || fileOpenHere
    const filesShown = files && (!unreadOnly || fileOpenHere)
    if (unreadOnly && !chat && topicsShown.length + initiativesShown.length === 0 && !filesShown && openTeam !== team.id) return null
    const placeRow = (topic: ForeignObject, place: 'topic' | 'initiative') => (
      <TreeRow
        key={topic.ref}
        file={topic}
        unread={unread}
        news={news}
        tones={tones}
        selectedRef={selectedRef}
        onControl={onControl}
        nested
        place={place}
        notFollowing={notFollowingOf?.(team, topic) ?? false}
        leaves={leavesOf?.(topic) ?? false}
        // A member turns one into the other (T-31): Make it an initiative on a topic, Make it a topic on an initiative.
        space={
          team.isMember && onMarkSpace
            ? place === 'topic'
              ? { action: 'unmark', onToggle: () => onMarkSpace(team, topic, false) }
              : { action: 'mark', onToggle: () => onMarkSpace(team, topic, true) }
            : undefined
        }
      />
    )
    const inside = chatOpenHere ? `chat:${team.id}` : openTeam === team.id ? selectedRef : undefined
    return (
      <NavItem
        key={team.id}
        href={`/app/teams/${team.id}`}
        label={team.name}
        // The team icon on every team: there are no private teams (Katerina, 16 November).
        icon={<IconUsers {...ICON} aria-hidden />}
        active={teamPageOpen(team)}
        defaultOpen
        {...(inside ? { openFor: inside } : {})}
        {...(team.isMember && onStartTopic ? { action: { icon: <IconPlus {...ICON} />, tooltip: `New topic in ${team.name}`, onClick: () => onStartTopic(team) } } : {})}
      >
        {chat && (
          <TeamChatRow
            team={team}
            unread={chatUnread[team.id] === true}
            news={chatNews?.[team.id]}
            tone={chatTones?.[team.id]}
            active={chatOpenHere}
            {...(onCopyChatLink ? { onCopyLink: () => onCopyChatLink(team) } : {})}
            {...(onToggleChatOpenWork && team.chat?.in === true
              ? { openWork: { action: chatInOpenWork?.(team) ? ('remove' as const) : ('add' as const), onToggle: () => onToggleChatOpenWork(team) } }
              : {})}
          />
        )}
        {topicsShown.map((topic) => placeRow(topic, 'topic'))}
        {/*
          The initiatives it leads, after its topics, as today's Peek lists them, each with its own icon (Katerina, 16
          November: T-14 changed), in one fold as its Files are (17 November).
        */}
        {initiativesShown.length > 0 && (
          <TeamInitiativesFold
            holdsOpen={!!selectedRef && initiativesShown.some((topic) => topic.ref === selectedRef)}
            selectedRef={selectedRef}
            unreadOnly={unreadOnly}
            litTones={initiativesShown.filter((topic) => unread[topic.ref] === true).map((topic) => tones?.[topic.ref])}
          >
            {initiativesShown.map((topic) => placeRow(topic, 'initiative'))}
          </TeamInitiativesFold>
        )}
        {filesShown && (
          <TeamFilesFold
            team={team}
            holdsOpen={fileOpenHere}
            selectedRef={selectedRef}
            selectedParent={selectedParent}
            unreadOnly={unreadOnly}
            onControl={onControl}
            renderFiles={renderFiles}
          />
        )}
      </NavItem>
    )
  }

  const yoursShown = yours.map(section).filter(Boolean)
  // Under Unread, a team you are not in shows only while it is open (today's).
  const othersShown = unreadOnly ? others.filter((team) => team.id === openTeam) : others

  if (teams.length === 0) return <EmptyState scope="section" message="No teams yet." />
  if (yoursShown.length + othersShown.length === 0) return <EmptyState scope="section" message="Nothing unread." />

  const selected = chatOpen && openTeam ? `chat:${openTeam}` : (selectedRef ?? openTeam ?? undefined)
  return (
    // 8px between the teams and above Other teams (Katerina, 17 November: "a bit more spacing between the parent expandable items").
    <NavTree spaced {...(selected ? { selected } : {})}>
      {yoursShown}
      {othersShown.length > 0 && (
        // The kit's fold as a row among rows, a row's size and colour, with its count (Katerina, 16 November).
        <CollapsibleSection
          look="row"
          title="Other teams"
          count={othersShown.length}
          defaultOpen={othersShown.some((team) => team.id === openTeam)}
          {...(othersShown.some((team) => team.id === openTeam) && openTeam ? { openFor: openTeam } : {})}
          contentClassName="gap-0.5"
        >
          {othersShown.map((team) => (
            <NavItem key={team.id} href={`/app/teams/${team.id}`} label={team.name} icon={<IconUsers {...ICON} aria-hidden />} active={openTeam === team.id && !chatOpen} />
          ))}
        </CollapsibleSection>
      )}
    </NavTree>
  )
}
