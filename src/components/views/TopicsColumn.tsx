import { useState } from 'react'
import { EmptyState, ListColumn, NavItem, NavTree, SkeletonList, Toolbar } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import { ListedFillsProvider, listingOf, useConversationBadges, useFolders, useListedNews, usePeekActions, useTeams, useTopicsColumn, type RowNewsItem, type TopicsColumnState } from '@/api'
import { useToast } from '@/lib/toast'
import { TreeRow } from '@/components/views/FileTreeView'

type SpaceToggle = { action: 'mark' | 'unmark'; onToggle: () => void }
import { HeaderStartTopic, NewTopicButton } from '@/components/views/HeaderStartTopic'
import { TreeColumn } from '@/lib/openedFrom'
import type { FileControl } from '@/components/views/useFileControls'
import { useRailClosed } from '@/layouts/railClosed'

/** Where Explore topics is (TOPI-6). */
export const EXPLORE_TOPICS_PATH = '/app/topics/explore'

/**
 * **Peek's Topics column** (TOP-4, TOPI-10): the topics you are a member of,
 * one flat list, the one where something just happened on top, re-sorted live
 * (Miky, 3 and 6 Nov: "sort the topics … based on recent activity", "remove
 * the subfiles from topics so it's plain list"). A topic's files, its archived
 * ones included, are in its Overview. Then one "Explore topics" row, which
 * opens the page of every topic you can read, archived ones too (TOPI-6), in
 * place of the "Other topics" and "Archived" sections. Its header has New
 * topic, as Folders' has (Miky, 2 Nov, TOP-9).
 * Built from the approved prototype (peek `concept/topics-level-up`,
 * `TopicsColumn.tsx`; Miky, 6 Nov).
 *
 * A row is the Folder tree's own (`TreeRow`): a link that opens its file
 * beside this column, with the same menu and dot.
 */
export function TopicsColumn({ selectedRef, exploring = false, onControl }: {
  /** `ref` of the open file, whose row is current. */
  selectedRef?: string
  /** Explore topics is open beside the column: its row is current. */
  exploring?: boolean
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  const { state, signedOut } = useTopicsColumn()
  const railClosed = useRailClosed()
  // Your topics carry the dot, as the Folder tree's rows do; the others are not yours to hear about.
  // A topic also lights for news on a file it lists, and for what names you one level under one, from what the column already holds (TOPI-3, ACT-2).
  const listed = useListedNews()
  const { unread, news, fills } = useConversationBadges(typeof state === 'object' && 'mine' in state ? state.mine : undefined, { listed })
  const [starting, setStarting] = useState(false)
  /*
    A topic's row offers Make it a space to a member of its team, as the Teams column does (TEA-5, TOPI-7). The teams
    read is the one a topic's page and the Teams column share, kept for the tab; Leave names the topic's team from it too.
  */
  const { teams } = useTeams()
  const { markSpace } = usePeekActions()
  const { showToast } = useToast()
  const spaceOf = (topic: ForeignObject): SpaceToggle | undefined => {
    const listing = listingOf(teams, topic.address ?? undefined)
    if (!listing || !listing.team.isMember || listing.team.archived || !topic.address) return undefined
    return {
      action: listing.space ? 'unmark' : 'mark',
      onToggle: () =>
        void markSpace(listing.team.id, topic.address!, !listing.space).then((result) => {
          if (!result.ok) showToast({ label: result.reason, type: 'error' })
        }),
    }
  }
  // An archived team's topics are read-only (§3.2): their rows offer no Leave, as their page's switch cannot change.
  const leaves = (topic: ForeignObject): boolean => {
    const team = listingOf(teams, topic.address ?? undefined)?.team ?? teams?.find((candidate) => candidate.id === topic.folder)
    return !team?.archived
  }
  // The Folder list New topic chooses from, read with the column (one shared read per tab), so its dialog opens on the press.
  useFolders()
  // The open file's Folder is chosen first, as the open Folder is in Folders.
  const openFolder =
    typeof state === 'object' && 'mine' in state ? [...state.mine, ...state.others].find((file) => file.ref === selectedRef)?.folder : undefined
  return (
    // A lit topic's card reads the rest of its listed files' new comments while it is open (383a4d3b).
    <ListedFillsProvider value={fills}>
      <TopicsColumnView
        state={state}
        signedOut={signedOut}
        railClosed={railClosed}
        unread={unread}
        news={news}
        selectedRef={selectedRef}
        exploring={exploring}
        onControl={onControl}
        onNewTopic={() => setStarting(true)}
        spaceOf={spaceOf}
        leavesOf={leaves}
      />
      {starting && <HeaderStartTopic column="topics" defaultFolder={openFolder} onClose={() => setStarting(false)} />}
    </ListedFillsProvider>
  )
}

/** `TopicsColumn` handed what it draws — the half a story can show. */
export function TopicsColumnView({
  state,
  signedOut = false,
  railClosed = false,
  unread = {},
  news,
  selectedRef,
  exploring = false,
  onControl,
  onNewTopic,
  spaceOf,
  leavesOf,
}: {
  state: TopicsColumnState
  signedOut?: boolean
  railClosed?: boolean
  unread?: Record<string, boolean>
  /** What lit each lit row (ACT-3), for its card. */
  news?: Record<string, readonly RowNewsItem[]>
  selectedRef?: string
  exploring?: boolean
  onControl?: (control: FileControl, file: ForeignObject) => void
  /** A topic's Make it a space, for a member of its team (TEA-5, TOPI-7). */
  spaceOf?: (topic: ForeignObject) => SpaceToggle | undefined
  /** Whether a topic's row offers Leave: not in an archived team. Every row does when absent. */
  leavesOf?: (topic: ForeignObject) => boolean
  /** The header's New topic (TOP-9), as Folders' header has; none signed out, since starting one acts as somebody. */
  onNewTopic?: () => void
}) {
  return (
    <ListColumn
      title="Topics"
      collapsed={railClosed}
      actions={
        !signedOut &&
        onNewTopic && (
          <Toolbar aria-label="Topic list actions" surface={false}>
            <NewTopicButton onClick={onNewTopic} />
          </Toolbar>
        )
      }
    >
      {/* A row clicked here opens its file with this column beside it. */}
      <TreeColumn.Provider value="topics">
        <TopicsBody state={state} signedOut={signedOut} unread={unread} news={news} selectedRef={selectedRef} exploring={exploring} onControl={onControl} spaceOf={spaceOf} leavesOf={leavesOf} />
      </TreeColumn.Provider>
    </ListColumn>
  )
}

function TopicsBody({
  state,
  signedOut,
  unread,
  news,
  selectedRef,
  exploring,
  onControl,
  spaceOf,
  leavesOf,
}: {
  state: TopicsColumnState
  signedOut: boolean
  unread: Record<string, boolean>
  news?: Record<string, readonly RowNewsItem[]>
  selectedRef?: string
  exploring: boolean
  onControl?: (control: FileControl, file: ForeignObject) => void
  spaceOf?: (topic: ForeignObject) => SpaceToggle | undefined
  /** Whether a topic's row offers Leave: not in an archived team. Every row does when absent. */
  leavesOf?: (topic: ForeignObject) => boolean
}) {
  if (signedOut) return <EmptyState scope="section" message="Sign in to see topics." />
  if (state === 'loading') return <SkeletonList />
  if ('failed' in state) return <EmptyState scope="section" message="Couldn’t load your topics. Reload to try again." />
  return (
    <NavTree selected={selectedRef}>
      {/* The approved story's empty line (Miky, 6 Nov), above Explore topics, where every other topic is. */}
      {state.mine.length === 0 && <EmptyState scope="section" message="You’re in no topics yet." />}
      {state.mine.map((topic) => (
        <TreeRow key={topic.ref} file={topic} unread={unread} news={news} selectedRef={selectedRef} onControl={onControl} space={spaceOf?.(topic)} leaves={leavesOf?.(topic) ?? true} nested />
      ))}
      {/* Where every other topic is, archived ones too, in place of the Other topics and Archived sections; no icon: a way in, not another kind of topic (Miky, 6 Nov). */}
      <ExploreRow exploring={exploring} />
    </NavTree>
  )
}

/** The last row: Explore topics, a link the kit's router follows, current while its page is open. */
function ExploreRow({ exploring }: { exploring: boolean }) {
  return <NavItem href={EXPLORE_TOPICS_PATH} label="Explore topics" active={exploring} />
}

/** The column while the file's page has not yet decided which it shows: a skeleton, under no title. */
export function PendingColumn() {
  const railClosed = useRailClosed()
  return (
    <ListColumn title="" collapsed={railClosed}>
      <SkeletonList />
    </ListColumn>
  )
}
