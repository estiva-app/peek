import { useMemo, useState } from 'react'
import { IconArchive } from '@tabler/icons-react'
import { EmptyState, ListColumn, NavItem, NavTree, NavTreeSection, SkeletonList, Toolbar } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import { useConversationBadges, useFolders, useTopicsColumn, type TopicWithFiles, type TopicsColumnState } from '@/api'
import { Button } from '@/components/ui/Button'
import { DialogShell } from '@/components/ui/DialogShell'
import { TreeRow } from '@/components/views/FileTreeView'
import { HeaderStartTopic, NewTopicButton } from '@/components/views/HeaderStartTopic'
import { filePath } from '@/lib/objectUrl'
import { TreeColumn } from '@/lib/openedFrom'
import type { FileControl } from '@/components/views/useFileControls'
import { useRailClosed } from '@/layouts/railClosed'

/** Where "Other topics" is kept open or closed on this browser. */
export const OTHER_TOPICS_KEY = 'peek.topics.others.open'
/** And "Archived". */
export const ARCHIVED_TOPICS_KEY = 'peek.topics.archived.open'

/**
 * **Peek's Topics column** (TOP-4): the topics you are a member of, A–Z, each
 * with the files its list holds under it, one level deep and from any Folder
 * — no Folder headings, and an issue never folds under its project. Then
 * "Other topics", collapsed until opened, title only: open one to join it.
 * Last "Archived", collapsed too: only active topics and files are on the
 * list (Miky, 2 Nov, b1ace226), and a topic's archived files are one
 * "Archived" line under it that opens them in a dialog. Its header has New
 * topic, as Folders' has (Miky, 2 Nov, TOP-9).
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
  const [starting, setStarting] = useState(false)
  // The Folder list New topic chooses from, read with the column (one shared read per tab), so its dialog opens on the press.
  useFolders()
  // The open file's Folder is chosen first, as the open Folder is in Folders.
  const openFolder =
    typeof state === 'object' && 'mine' in state
      ? [...state.mine.flatMap(({ topic, files }) => [topic, ...files]), ...state.others].find((file) => file.ref === selectedRef)?.folder
      : undefined
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
  /*
    The topic whose archived files are open in the dialog — held here, outside
    the rows: a click in a portal still bubbles through its React parents. By
    ref, and its files read from the state on each render, so an Unarchive from
    a row in the dialog leaves it at once; with none left, it closes.
  */
  const [archivedRef, setArchivedRef] = useState<string | null>(null)
  const archivedOf =
    archivedRef && typeof state === 'object' && 'mine' in state
      ? state.mine.find(({ topic, archivedFiles }) => topic.ref === archivedRef && archivedFiles.length > 0)
      : undefined
  const close = () => setArchivedRef(null)
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
        <TopicsBody state={state} signedOut={signedOut} unread={unread} selectedRef={selectedRef} onControl={onControl} onArchived={(entry) => setArchivedRef(entry.topic.ref)} />
        {archivedOf && (
          <DialogShell
            title={`Archived in ${archivedOf.topic.slots.title?.value ?? 'Untitled'}`}
            onClose={close}
            width={480}
            bodyClassName="p-0 py-2"
            footer={
              <Button variant="outlined" onClick={close}>
                Close
              </Button>
            }
          >
            {/* A file opened here closes it, as the page beside the column opens; one sent to a new tab leaves it open. */}
            <div
              onClickCapture={(event) =>
                event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && (event.target as Element).closest('a[data-file]') && close()
              }
            >
              <NavTree selected={selectedRef}>
                {archivedOf.archivedFiles.map((file) => (
                  <TreeRow key={file.ref} file={file} selectedRef={selectedRef} onControl={onControl} nested />
                ))}
              </NavTree>
            </div>
          </DialogShell>
        )}
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
  onArchived,
}: {
  state: TopicsColumnState
  signedOut: boolean
  unread: Record<string, boolean>
  selectedRef?: string
  onControl?: (control: FileControl, file: ForeignObject) => void
  onArchived: (topic: TopicWithFiles) => void
}) {
  if (signedOut) return <EmptyState scope="section" message="Sign in to see topics." />
  if (state === 'loading') return <SkeletonList />
  if ('failed' in state) return <EmptyState scope="section" message="Couldn’t load your topics. Reload to try again." />
  const { mine, others, archived } = state
  // A section's empty line takes no button (the kit's EmptyState): Folders is the rail item below.
  if (mine.length === 0 && others.length === 0 && archived.length === 0)
    return <EmptyState scope="section" message="No topics yet. Your files are in Folders." />
  // The topics that list the open file open onto it, as a Folder opens onto its row.
  const listing = mine.filter(({ topic, files }) => topic.ref !== selectedRef && files.some((file) => file.ref === selectedRef)).map(({ topic }) => topic.ref)
  const otherOpen = others.some((topic) => topic.ref === selectedRef)
  const archivedOpen = archived.some((topic) => topic.ref === selectedRef)
  return (
    <NavTree selected={selectedRef}>
      {mine.length === 0 && others.length === 0 && <EmptyState scope="section" message="No active topics." />}
      {mine.length === 0 && others.length > 0 && <EmptyState scope="section" message="You haven’t joined a topic yet. Open one below to join it." />}
      {mine.map((entry) => {
        const { topic, files, archivedFiles } = entry
        const title = topic.slots.title?.value ?? 'Untitled'
        const rows = [
          ...files.map((file) => (
            // `nested`: a file's own row, never one that opens onto others (one level deep).
            <TreeRow key={file.ref} file={file} unread={unread} selectedRef={selectedRef} onControl={onControl} nested />
          )),
          // Its archived files, out of the way and one press from here (Miky, 2 Nov): a link to the topic's page, whose right column lists them too.
          ...(archivedFiles.length > 0
            ? [
                <NavItem
                  key="archived"
                  href={topic.address ? filePath(topic.address, title) : '#'}
                  label="Archived"
                  count={archivedFiles.length}
                  countLabel={`${archivedFiles.length} archived in ${title}`}
                  icon={<IconArchive size={16} stroke={1.5} />}
                  onPlainClick={(event) => {
                    event.preventDefault()
                    onArchived(entry)
                  }}
                />,
              ]
            : []),
        ]
        return (
          <TreeRow
            key={topic.ref}
            file={topic}
            unread={unread}
            selectedRef={selectedRef}
            expand={listing}
            onControl={onControl}
            remember
            nested={rows.length === 0}
            under={rows.length > 0 ? rows : undefined}
          />
        )
      })}
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
