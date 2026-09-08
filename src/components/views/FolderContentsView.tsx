import type { FolderContents } from '@estiva-app/interop'
import type { FolderContentsState } from '@/api'
import { ForeignObjectCard } from '@/components/ui/ForeignObjectWidget'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'

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
export function FolderContentsView({ state }: { state: FolderContentsState }) {
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
    return <EmptyState message="This folder could not be read." />
  }

  const folder = state as FolderContents
  if (folder.files.length === 0) {
    return <EmptyState message="Nothing in this folder yet." />
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
      {folder.files.map((file) => (
        <ForeignObjectCard key={file.ref} object={file} />
      ))}
    </div>
  )
}
