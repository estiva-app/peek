import { useState } from 'react'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { KIND_BARE_FILE } from '@estiva-app/interop'
import type { FolderContents, ForeignObject } from '@estiva-app/interop'
import type { FolderContentsState } from '@/api'
import { useConversationBadges, useForeignChildren } from '@/api'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { PersonRow } from '@/components/ui/PersonRow'
import { SkeletonSidebarList, SkeletonRow } from '@/components/ui/Skeleton'
import { listedChildrenOf, peersOf } from '@/components/views/FolderContentsView'
import type { FileControl } from '@/components/views/useFileControls'
import { fileControlsOf } from '@/lib/fileControls'

/**
 * A line where the tree's rows would be: empty, or unreadable. Level with the
 * rows (Katerina, 2026-09-14): each PersonRow pads itself, so the line takes a
 * row's inset here, and EmptyState is never padded.
 */
function TreeLine({ message }: { message: string }) {
  return (
    <div className="px-2 py-1">
      <EmptyState scope="section" message={message} />
    </div>
  )
}

/**
 * One Folder's files as sidebar rows — the file page's left column (FOL-19).
 *
 * **Lines, not cards.** `FolderContentsView` draws every file as a
 * `ForeignObjectCard`, which is right at the Folder page's full width and
 * wrong in a 290px column: a Ship project's card wraps its whole description
 * into a tower and the tree it sits in disappears (Miky, 2026-09-14). This is
 * the same listing drawn the way the Topics list draws its rows — `PersonRow`,
 * one line each, the glyph on the left and the dot on the right — so a file in
 * the tree reads like a topic in the list, which is what it is about to
 * replace (FOL-21).
 *
 * **Same model, same reads.** Peers at the top (`peersOf`), a parent's children
 * under it when it is open (`listedChildrenOf` for what this listing already
 * holds, `useForeignChildren` for what the owner's manifest lists), one badge
 * request per level. What differs from the card view is only how a row is
 * drawn — no kind number here either, and the row's glyph is the one honest
 * distinction: Peek's bare file is a topic, and everything else is a file.
 */
export function FileTreeView({
  state,
  selectedRef,
  expand,
  onSelect,
  onControl,
}: {
  state: FolderContentsState
  /** `ref` of the file this page is showing. */
  selectedRef?: string
  /**
   * `ref`s to start expanded — the open file's parent. A default, not a lock:
   * a person who collapses a row keeps it collapsed.
   */
  expand?: readonly string[]
  onSelect: (file: ForeignObject) => void
  /**
   * A row's more-menu asked for its details, a rename or a deletion (FOL-33).
   * The menu is drawn only on a row whose manifest declares the control —
   * `fileControlsOf` — and only when there is somebody to tell: a tree drawn
   * without this has no menus, exactly as before.
   */
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  const files = typeof state === 'object' && 'files' in state ? state.files : undefined
  const { unread } = useConversationBadges(files ? peersOf(files) : undefined)

  if (state === 'loading') {
    return (
      <div className="py-1" data-loading="file-tree">
        <SkeletonSidebarList />
      </div>
    )
  }
  // Unreadable is not empty — the line the whole codebase holds (PEE-10).
  if ('failed' in state) {
    return <TreeLine message="This folder could not be read." />
  }
  const folder = state as FolderContents
  if (folder.files.length === 0) {
    return <TreeLine message="Nothing in this folder yet." />
  }

  return (
    <div className="flex flex-col gap-0.5" data-folder={folder.id} data-source={folder.source}>
      {peersOf(folder.files).map((file) => (
        <TreeRow
          key={file.ref}
          file={file}
          listed={folder.files}
          unread={unread}
          selectedRef={selectedRef}
          expand={expand}
          onSelect={onSelect}
          onControl={onControl}
        />
      ))}
    </div>
  )
}

/**
 * One row, and the rows inside it when it is open.
 *
 * The chevron sits in a gutter beside the row rather than inside it, because
 * `PersonRow` is the Topics list's row and has no expander — a topic has
 * nothing inside it. Fixed width whether or not there is a control, so the
 * titles line up down the column.
 */
function TreeRow({
  file,
  listed = [],
  unread,
  selectedRef,
  expand,
  onSelect,
  onControl,
  nested = false,
}: {
  file: ForeignObject
  listed?: ForeignObject[]
  unread?: Record<string, boolean>
  selectedRef?: string
  expand?: readonly string[]
  onSelect: (file: ForeignObject) => void
  onControl?: (control: FileControl, file: ForeignObject) => void
  nested?: boolean
}) {
  // `expand` decides until the person does — see `FileRow` for why this is
  // not an initialiser and not an effect.
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? !!expand?.includes(file.ref)
  const title = file.slots.title?.value ?? 'Untitled'
  const listedChildren = listedChildrenOf(file, listed)
  const expandable = (!nested && file.listsChildren) || listedChildren.length > 0
  // The row's menu, from the manifest and not from the kind (FOL-33): a bare
  // file's declares rename and delete, a Ship issue's declares neither, and
  // the glyph below is the one place this file asks what kind a row is.
  const controls = onControl ? fileControlsOf(file) : {}
  const offers = !!controls.rename || !!controls.delete

  return (
    <div data-file={file.ref}>
      <div className="flex items-center">
        <div className="flex w-6 shrink-0 justify-center">
          {expandable && (
            <IconButton
              aria-label={open ? `Hide what is in ${title}` : `Show what is in ${title}`}
              aria-expanded={open}
              tooltip={open ? 'Collapse' : 'Expand'}
              onClick={() => setToggled(!open)}
            >
              {open ? (
                <IconChevronDown size={16} stroke={1.5} />
              ) : (
                <IconChevronRight size={16} stroke={1.5} />
              )}
            </IconButton>
          )}
        </div>
        <PersonRow
          className="min-w-0 flex-1"
          name={title}
          type={file.kind === KIND_BARE_FILE ? 'topic' : 'file'}
          /* `=== true`: an unjudged file draws no dot, not a dark one. */
          isUnread={unread?.[file.ref] === true}
          isSelected={file.ref === selectedRef}
          onClick={() => onSelect(file)}
          onOpenDetails={offers ? () => onControl?.('details', file) : undefined}
          onRename={controls.rename ? () => onControl?.('rename', file) : undefined}
          onDeleteTopic={controls.delete ? () => onControl?.('delete', file) : undefined}
        />
      </div>
      {open && (
        <div className="flex flex-col gap-0.5 pl-6" data-children-of={file.ref}>
          {!nested && file.listsChildren && file.naddr && (
            <FetchedRows
              naddr={file.naddr}
              exclude={listedChildren}
              selectedRef={selectedRef}
              expand={expand}
              onSelect={onSelect}
              onControl={onControl}
            />
          )}
          {listedChildren.map((child) => (
            <TreeRow
              key={child.ref}
              file={child}
              listed={listed}
              unread={unread}
              selectedRef={selectedRef}
              expand={expand}
              onSelect={onSelect}
              onControl={onControl}
              nested
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** The children the owner's manifest lists, fetched when the row opens. */
function FetchedRows({
  naddr,
  exclude = [],
  selectedRef,
  expand,
  onSelect,
  onControl,
}: {
  naddr: string
  exclude?: ForeignObject[]
  selectedRef?: string
  expand?: readonly string[]
  onSelect: (file: ForeignObject) => void
  onControl?: (control: FileControl, file: ForeignObject) => void
}) {
  const { state } = useForeignChildren(naddr)
  const drawn = new Set(exclude.map((file) => file.ref))
  const children = Array.isArray(state) ? state.filter((child) => !drawn.has(child.ref)) : []
  const { unread } = useConversationBadges(Array.isArray(state) ? state : undefined)

  if (state === 'loading') return <SkeletonRow />
  if (state === 'unresolved' || (!Array.isArray(state) && 'failed' in state)) {
    return <TreeLine message="What is in this could not be read." />
  }
  if (children.length === 0) {
    return exclude.length === 0 ? <TreeLine message="Nothing in this yet." /> : null
  }
  return (
    <>
      {children.map((child) => (
        <TreeRow
          key={child.ref}
          file={child}
          unread={unread}
          selectedRef={selectedRef}
          expand={expand}
          onSelect={onSelect}
          onControl={onControl}
          nested
        />
      ))}
    </>
  )
}
