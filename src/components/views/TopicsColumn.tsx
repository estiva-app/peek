import { useState } from 'react'
import { EmptyState, ListColumn, NavTree, NavTreeSection, SkeletonList, Toolbar } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import { useConversationBadges, useFolders, useTopicsColumn, type TopicsColumnState } from '@/api'
import { TreeRow } from '@/components/views/FileTreeView'
import { HeaderStartTopic, NewTopicButton } from '@/components/views/HeaderStartTopic'
import { TreeColumn } from '@/lib/openedFrom'
import type { FileControl } from '@/components/views/useFileControls'
import { useRailClosed } from '@/layouts/railClosed'

/** Where "Other topics" is kept open or closed on this browser. */
export const OTHER_TOPICS_KEY = 'peek.topics.others.open'
/** And "Archived". */
export const ARCHIVED_TOPICS_KEY = 'peek.topics.archived.open'

/**
 * **Peek's Topics column** (TOP-4, TOPI-10): the topics you are a member of,
 * one flat list, the one where something just happened on top, re-sorted live
 * (Miky, 3 and 6 Nov: "sort the topics … based on recent activity", "remove
 * the subfiles from topics so it's plain list"). A topic's files, its archived
 * ones included, are in its Overview. Then "Other topics", collapsed until
 * opened, title only: open one to join it. Last "Archived", collapsed too:
 * only active topics are on the list (Miky, 2 Nov, b1ace226). Both sections
 * stay until Explore topics replaces them. Its header has New topic, as
 * Folders' has (Miky, 2 Nov, TOP-9).
 * Built from the approved prototype (peek `concept/topics-level-up`,
 * `TopicsColumn.tsx`; Miky, 6 Nov).
 *
 * A row is the Folder tree's own (`TreeRow`): a link that opens its file
 * beside this column, with the same menu and dot.
 */
export function TopicsColumn({ selectedRef, onControl }: {
  /** `ref` of the open file, whose row is current. */
  selectedRef?: string
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  const { state, signedOut } = useTopicsColumn()
  const railClosed = useRailClosed()
  // Your topics carry the dot, as the Folder tree's rows do; the others are not yours to hear about.
  const { unread } = useConversationBadges(typeof state === 'object' && 'mine' in state ? state.mine : undefined)
  const [starting, setStarting] = useState(false)
  // The Folder list New topic chooses from, read with the column (one shared read per tab), so its dialog opens on the press.
  useFolders()
  // The open file's Folder is chosen first, as the open Folder is in Folders.
  const openFolder =
    typeof state === 'object' && 'mine' in state ? [...state.mine, ...state.others].find((file) => file.ref === selectedRef)?.folder : undefined
  return (
    <>
      <TopicsColumnView
        state={state}
        signedOut={signedOut}
        railClosed={railClosed}
        unread={unread}
        selectedRef={selectedRef}
        onControl={onControl}
        onNewTopic={() => setStarting(true)}
      />
      {starting && <HeaderStartTopic column="topics" defaultFolder={openFolder} onClose={() => setStarting(false)} />}
    </>
  )
}

/** `TopicsColumn` handed what it draws — the half a story can show. */
export function TopicsColumnView({
  state,
  signedOut = false,
  railClosed = false,
  unread = {},
  selectedRef,
  onControl,
  onNewTopic,
}: {
  state: TopicsColumnState
  signedOut?: boolean
  railClosed?: boolean
  unread?: Record<string, boolean>
  selectedRef?: string
  onControl?: (control: FileControl, file: ForeignObject) => void
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
        <TopicsBody state={state} signedOut={signedOut} unread={unread} selectedRef={selectedRef} onControl={onControl} />
      </TreeColumn.Provider>
    </ListColumn>
  )
}

function TopicsBody({
  state,
  signedOut,
  unread,
  selectedRef,
  onControl,
}: {
  state: TopicsColumnState
  signedOut: boolean
  unread: Record<string, boolean>
  selectedRef?: string
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  if (signedOut) return <EmptyState scope="section" message="Sign in to see topics." />
  if (state === 'loading') return <SkeletonList />
  if ('failed' in state) return <EmptyState scope="section" message="Couldn’t load your topics. Reload to try again." />
  const { mine, others, archived } = state
  const otherOpen = others.some((topic) => topic.ref === selectedRef)
  const archivedOpen = archived.some((topic) => topic.ref === selectedRef)
  return (
    <NavTree selected={selectedRef}>
      {/* The approved story's empty line (Miky, 6 Nov); the sections below, while they stay, are where the others are. */}
      {mine.length === 0 && <EmptyState scope="section" message="You’re in no topics yet." />}
      {mine.map((topic) => (
        <TreeRow key={topic.ref} file={topic} unread={unread} selectedRef={selectedRef} onControl={onControl} nested />
      ))}
      {others.length > 0 && (
        <NavTreeSection
          id="other-topics"
          title="Other topics"
          defaultOpen={false}
          storageKey={OTHER_TOPICS_KEY}
          // Opened by link or from here, a topic of the section's keeps it open, so its row is seen.
          openFor={otherOpen ? selectedRef : undefined}
        >
          {others.map((topic) => (
            <TreeRow key={topic.ref} file={topic} selectedRef={selectedRef} onControl={onControl} nested />
          ))}
        </NavTreeSection>
      )}
      {/* The way to an archived topic (Miky, 2 Nov): out of the list, closed at its end; each opens read-only, with Unarchive. */}
      {archived.length > 0 && (
        <NavTreeSection
          id="archived-topics"
          title="Archived"
          defaultOpen={false}
          storageKey={ARCHIVED_TOPICS_KEY}
          openFor={archivedOpen ? selectedRef : undefined}
        >
          {archived.map((topic) => (
            <TreeRow key={topic.ref} file={topic} selectedRef={selectedRef} onControl={onControl} nested />
          ))}
        </NavTreeSection>
      )}
    </NavTree>
  )
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
