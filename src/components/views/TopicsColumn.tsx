import { useMemo } from 'react'
import { EmptyState, ListColumn, NavTree, NavTreeSection, SkeletonList } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import { useConversationBadges, useTopicsColumn, type TopicsColumnState } from '@/api'
import { TreeColumn, TreeRow } from '@/components/views/FileTreeView'
import type { FileControl } from '@/components/views/useFileControls'
import { useRailClosed } from '@/layouts/railClosed'

/** Where "Other topics" is kept open or closed on this browser. */
export const OTHER_TOPICS_KEY = 'peek.topics.others.open'

/**
 * **Peek's Topics column** (TOP-4): the topics you are a member of, A–Z, each
 * with the files its list holds under it, one level deep and from any Folder
 * — no Folder headings, and an issue never folds under its project. Then
 * "Other topics", collapsed until opened, title only: open one to join it.
 * Built from the Per app prototype (estiva-ui `concept/cross-app-navigation`,
 * `PerApp.tsx` PeekFrame), whose Topics lists topics flat; the files under
 * each are the agent's lean, for Katerina to polish (Miky, 1 November).
 *
 * A row is the Folder tree's own (`TreeRow`): a link that opens its file
 * beside this column, with the same menu and dot.
 */
export function TopicsColumn({ selectedRef, onControl }: {
  /** `ref` of the open file, whose rows are current — under every topic that lists it. */
  selectedRef?: string
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  const { state, signedOut } = useTopicsColumn()
  const railClosed = useRailClosed()
  // Your topics and their files carry the dot, as the Folder tree's rows do; the others are not yours to hear about.
  const drawn = useMemo(
    () => (typeof state === 'object' && 'mine' in state ? state.mine.flatMap(({ topic, files }) => [topic, ...files]) : undefined),
    [state],
  )
  const { unread } = useConversationBadges(drawn)
  return (
    <TopicsColumnView state={state} signedOut={signedOut} railClosed={railClosed} unread={unread} selectedRef={selectedRef} onControl={onControl} />
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
}: {
  state: TopicsColumnState
  signedOut?: boolean
  railClosed?: boolean
  unread?: Record<string, boolean>
  selectedRef?: string
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  return (
    <ListColumn title="Topics" collapsed={railClosed}>
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
  const { mine, others } = state
  // A section's empty line takes no button (the kit's EmptyState): Folders is the rail item below.
  if (mine.length === 0 && others.length === 0) return <EmptyState scope="section" message="No topics yet. Your files are in Folders." />
  // The topics that list the open file open onto it, as a Folder opens onto its row.
  const listing = mine.filter(({ topic, files }) => topic.ref !== selectedRef && files.some((file) => file.ref === selectedRef)).map(({ topic }) => topic.ref)
  const otherOpen = others.some((topic) => topic.ref === selectedRef)
  return (
    <NavTree selected={selectedRef}>
      {mine.length === 0 && <EmptyState scope="section" message="You haven’t joined a topic yet. Open one below to join it." />}
      {mine.map(({ topic, files }) => (
        <TreeRow
          key={topic.ref}
          file={topic}
          unread={unread}
          selectedRef={selectedRef}
          expand={listing}
          onControl={onControl}
          remember
          nested={files.length === 0}
          under={
            files.length > 0
              ? files.map((file) => (
                  // `nested`: a file's own row, never one that opens onto others (one level deep).
                  <TreeRow key={file.ref} file={file} unread={unread} selectedRef={selectedRef} onControl={onControl} nested />
                ))
              : undefined
          }
        />
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
