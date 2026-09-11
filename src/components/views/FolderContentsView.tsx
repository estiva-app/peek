import { useState } from 'react'
import {
  IconChevronDown,
  IconChevronRight,
  IconFolderShare,
  IconMessage,
} from '@tabler/icons-react'
import { CONVERSATION_LIMIT } from '@estiva-app/interop'
import type { FolderContents, ForeignObject } from '@estiva-app/interop'
import type { FolderContentsState } from '@/api'
import { useConversationCounts, useForeignChildren } from '@/api'
import { ForeignObjectCard } from '@/components/ui/ForeignObjectWidget'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonSidebarList, SkeletonRow } from '@/components/ui/Skeleton'
import { IconButton } from '@/components/ui/IconButton'

/**
 * One Folder, and everything in it — RFC 0.4 §4 and §5.
 *
 * **The view that is supposed to look boring.** Every row is a
 * `ForeignObjectWidget`, the same component that draws a `nostr:naddr…` pasted
 * into a message, and nothing here knows what any of the rows are. A Ship
 * project, another Peek topic and a record from an app nobody has written are
 * the same case: an address, resolved through its owner's manifest, drawn
 * through the widget chain in Peek's design language.
 *
 * That is the whole claim, and it is why this file must never grow a kind
 * number. A `kind === 30850` branch here would turn a container into an
 * integration with Ship, which is the thing the projection layer exists to
 * avoid.
 *
 * **Peers, not nesting.** The rows are the Folder's contents, flat, in the
 * order the Folder lists them. A project's own issues are *its* children and
 * belong in the panel that draws that project; listing them here would put two
 * apps at different levels of one list.
 *
 * **A file the reader cannot see is absent, not greyed out.** The read model
 * drops it (RFC 0.4 §4.2 — the count is the disclosure), so an empty Folder and
 * a Folder whose contents this viewer may not read render identically. That is
 * deliberate: rendering "3 hidden" would tell an outsider exactly how much they
 * are missing, which for a Folder named after a person is the sensitive part.
 */
export function FolderContentsView({
  state,
  selectedRef,
  onSelect,
  onMove,
  counts,
}: {
  state: FolderContentsState
  /** `ref` of the file whose conversation is open, if any. */
  selectedRef?: string
  /** Omit and the rows carry no conversation control at all. */
  onSelect?: (file: ForeignObject) => void
  /** Omit and the rows carry no move control — a read-only listing. */
  onMove?: (file: ForeignObject) => void
  /**
   * Message count per file `ref`. A **missing** entry draws no badge; it means
   * nobody asked, which is not the same as none — see `useConversationCounts`.
   */
  counts?: Record<string, number>
}) {
  if (state === 'loading') {
    return (
      <div className="p-4" data-loading="folder">
        <SkeletonSidebarList />
      </div>
    )
  }

  /*
    A refused read is not an empty Folder, and the two must not read alike.

    Before `useFolderProject` learned this distinction, "no project linked to
    this topic" was shown for a relay that had refused the read — the exact
    ambiguity PEE-10 exists to remove. The same trap is here, one level up.
  */
  if ('failed' in state) {
    return <EmptyState scope="section" className="p-4" message="This folder could not be read." />
  }

  const folder = state as FolderContents
  if (folder.files.length === 0) {
    return <EmptyState scope="section" className="p-4" message="Nothing in this folder yet." />
  }

  return (
    <div className="flex flex-col gap-2 p-4" data-folder={folder.id} data-source={folder.source}>
      {/*
        Said out loud, because the two are not equivalent and a short list is
        the only visible symptom. Containment by `h` lists an app's records and
        can never list a topic — under `h` a topic is the container rather than
        something inside it — so a Folder with no state event shows less than it
        holds and nothing else on screen would say why.
      */}
      {folder.source === 'channel' && (
        <p className="text-caption text-text-muted">
          From channel contents; this folder has no folder state yet.
        </p>
      )}
      {/*
        `ForeignObjectCard`, not `ForeignObjectWidget`: the widget resolves a
        reference against the relay, and these are already resolved — the read
        model returned them. Passing them back through the resolver would be a
        second round trip per row for an answer we hold, and it drags Convex
        into a view that otherwise needs none.

        No `onAct`, so the card is read-only. A folder listing is navigation;
        the manifest's controls belong where the object itself is open, and
        offering an action here that the row has no context to complete is the
        thing "only offer actions that can succeed" rules out.
      */}
      {peersOf(folder.files).map((file) => (
        <FileRow
          key={file.ref}
          file={file}
          counts={counts}
          selectedRef={selectedRef}
          onSelect={onSelect}
          onMove={onMove}
        />
      ))}
    </div>
  )
}

/**
 * The files that belong at the top level — RFC 0.4 §4.
 *
 * **A child is not also a peer.** A folder with no state event is read by
 * containment, and Ship writes the folder's `h` on an issue as well as on its
 * project, so both arrive in the listing. Before this view drew nesting that
 * was merely flat; once a project expands to its issues, every issue appears
 * twice — once under its project and once beside it. Reported on production's
 * "Feedback on Peek", which has no folder state.
 *
 * So a file whose `parentRef` names another file **in this same listing** is
 * dropped from the top level and reached by expanding its parent instead.
 *
 * The qualifier is the whole rule. An issue whose project is *not* in this
 * folder stays a peer: it is genuinely a top-level member here, and hiding it
 * would make it unreachable — a file in a folder that the folder does not show.
 * That is the disclosure bug §4.2 spends its whole argument avoiding, arrived
 * at from the other direction.
 *
 * Nesting is still fetched rather than taken from the listing. A state folder
 * may list a project and only some of its issues, and drawing that subset as
 * "the project's issues" would be a different and quieter wrong answer than
 * the one this fixes.
 */
export function peersOf(files: ForeignObject[]): ForeignObject[] {
  const listed = new Set(files.map((file) => file.address).filter(Boolean) as string[])
  return files.filter((file) => !(file.parentRef && listed.has(file.parentRef)))
}

/**
 * How many messages, when we know — and nothing at all when we do not.
 *
 * Three cases and only one of them draws: a number we asked for and got, a zero,
 * and an absence. The absence must stay silent. A file with no address was never
 * askable and a "0" over it would be an assertion nobody made; a Peek topic
 * genuinely counts zero because its messages carry `h` and no `a`, so drawing
 * "0" there would deny a conversation that exists. Only a positive count says
 * something a reader can act on, which is the whole point of the badge.
 */
function ConversationCount({ count }: { count: number | undefined }) {
  if (!count) return null
  // Saturated at the same constant the panel reads with, so "200" here and a
  // panel showing exactly 200 agree rather than looking like a coincidence.
  const label = count >= CONVERSATION_LIMIT ? `${CONVERSATION_LIMIT}+` : String(count)
  return (
    <span className="shrink-0 text-caption text-text-muted tabular-nums" data-count={count}>
      {label}
    </span>
  )
}

/**
 * One file, and the files inside it.
 *
 * **The expander is offered only where the owning app declared one.**
 * `listsChildren` is interop answering both halves — a child list is declared
 * *and* the app says how to draw its kind — so a Peek topic, which declares
 * none, gets no control rather than a disclosure that opens onto nothing.
 *
 * Nesting rather than peers, because that is what the objects are: an issue is
 * a child of its project, not a sibling of it in the Folder. Listing both flat
 * put two apps' objects at different levels of one list, which is the thing
 * this view's header warns against — the fix is to draw the level, not to
 * flatten it away. `MAX_LIST_DEPTH` is 1, so a child never expands further and
 * no row here offers it.
 */
function FileRow({
  file,
  counts,
  selectedRef,
  onSelect,
  onMove,
  nested = false,
}: {
  file: ForeignObject
  counts?: Record<string, number>
  selectedRef?: string
  onSelect?: (file: ForeignObject) => void
  onMove?: (file: ForeignObject) => void
  nested?: boolean
}) {
  const [open, setOpen] = useState(false)
  const title = file.slots.title?.value ?? 'this file'

  return (
    <div data-file={file.ref}>
      <div className="flex items-start gap-1">
        {/*
          A fixed slot whether or not there is a control, so the cards line up
          down the list. A row that shifted left when its neighbour became
          expandable would read as two lists.
        */}
        <div className="w-6 shrink-0 pt-1">
          {!nested && file.listsChildren && (
            <IconButton
              aria-label={open ? `Hide what is in ${title}` : `Show what is in ${title}`}
              aria-expanded={open}
              tooltip={open ? 'Collapse' : 'Expand'}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? (
                <IconChevronDown size={16} stroke={1.5} />
              ) : (
                <IconChevronRight size={16} stroke={1.5} />
              )}
            </IconButton>
          )}
        </div>
        <ForeignObjectCard object={file} className="min-w-0 flex-1" />
        {/*
          One cluster, on the card's first line. These were three loose
          children of an `items-start` row, so the count and the two controls
          each found their own height against a card that is a different height
          on every row — the count ended up floating at the card's top corner,
          attached to nothing (Katerina, 2026-09-11). `pt-1` is the gutter's,
          so the chevron, the title and these all start on one line.
        */}
        <div className="flex shrink-0 items-center gap-1 pt-1">
        <ConversationCount count={counts?.[file.ref]} />
        {/*
          Peek's aspect of this file, on request — RFC 0.5 §10.2.

          **Beside the card, not inside it.** The card's one link opens the
          owning app, which is that app's aspect of the same file and is
          asserted to be the only link on it; a second one in there would both
          break that and conflate "read it where it lives" with "read its
          conversation here".

          Only when the file has an `naddr`. A conversation is resolved by
          address — `#a` on the owner's comment kinds — so a non-addressable
          file has nothing to ask for, and offering the control anyway is the
          button that cannot succeed.
        */}
        {onSelect && file.naddr && (
          <IconButton
            aria-label={
              counts?.[file.ref]
                ? `Conversation about ${title}, ${counts[file.ref]} messages`
                : `Conversation about ${title}`
            }
            tooltip="Conversation"
            aria-current={file.ref === selectedRef ? true : undefined}
            onClick={() => onSelect(file)}
          >
            <IconMessage size={16} stroke={1.5} />
          </IconButton>
        )}
        {/*
          Re-filing, which only a top-level row can offer.

          **Not on a nested child.** A child is in this Folder by its parent —
          Ship writes the Folder's `h` on an issue, and the listing reaches it
          through the project — so "move this issue" would have to move the
          project to mean anything, and moving the issue alone would file it
          somewhere its project is not. `parentRef` exists to draw that
          relation; honouring it here is the other half.

          Only with an `address`: a Folder's contents are addresses, so a
          non-addressable file cannot be named in one.
        */}
        {onMove && !nested && file.address && (
          <IconButton
            aria-label={`Move ${title} to another folder`}
            tooltip="Move"
            onClick={() => onMove(file)}
          >
            <IconFolderShare size={16} stroke={1.5} />
          </IconButton>
        )}
        </div>
      </div>
      {open && file.naddr && (
        <div className="mt-2 flex flex-col gap-2 pl-6" data-children-of={file.ref}>
          <ChildRows naddr={file.naddr} selectedRef={selectedRef} onSelect={onSelect} />
        </div>
      )}
    </div>
  )
}

/**
 * The files inside one file, fetched when somebody asks for them.
 *
 * Its own counts request, for the same reason the top level has one: the
 * children arrive from a resolve that fetched no comments for them, so their
 * badges are a second question. It is one request for all of them, made once
 * per expansion.
 */
function ChildRows({
  naddr,
  selectedRef,
  onSelect,
}: {
  naddr: string
  selectedRef?: string
  onSelect?: (file: ForeignObject) => void
}) {
  const { state } = useForeignChildren(naddr)
  const children = Array.isArray(state) ? state : []
  const counts = useConversationCounts(Array.isArray(state) ? state : undefined)

  if (state === 'loading') return <SkeletonRow />
  /*
    Unreadable is not empty, one level down.

    `useForeignChildren` keeps `unresolved` and `failed` apart from `[]` so this
    can say which happened. Rendering a refused read as "nothing inside" is the
    same defect as the folder view's, and the reason that view has two branches.
  */
  if (state === 'unresolved' || (!Array.isArray(state) && 'failed' in state)) {
    return <EmptyState message="What is in this could not be read." />
  }
  if (children.length === 0) return <EmptyState message="Nothing in this yet." />

  return (
    <>
      {children.map((child) => (
        <FileRow
          key={child.ref}
          file={child}
          counts={counts}
          selectedRef={selectedRef}
          onSelect={onSelect}
          nested
        />
      ))}
    </>
  )
}
