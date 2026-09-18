import { Divider } from '@estiva-app/ui'
import type { People } from '@estiva-app/interop'
import type { FileThreadsState } from '@/api'
import type { FileComment } from '@/nostr/foreign'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { CommentRow } from '@/components/views/CommentRow'

/**
 * One comment and what was said under it — Peek's thread pane, pointed at
 * another app's conversation (FOL-19).
 *
 * **The root is drawn from the conversation, the replies from the relay.** They
 * arrive from two different reads and that is not an implementation detail: by
 * NIP-22 a reply's lowercase tags name the comment it answers, not the file, so
 * a reply carries no `a` tag and is invisible to the address-scoped read that
 * brings the comments back with the file. `useFileThreads` asks by `#e`
 * instead. The root is passed in rather than waited for, so the pane has a
 * heading the moment it opens.
 *
 * **Every app's thread, drawn the same way.** No kind number appears here, as
 * in the pane beside it: Ship writes its replies as `kind:9` and NIP-22 says
 * `kind:1111`, both are declared by the owning app's manifest, and both arrive
 * as replies. If this needed a branch per app the aspects model would not be
 * one.
 */
export function FileThreadView({
  root,
  state,
  people,
}: {
  /** The comment the thread hangs from, from the conversation beside it. */
  root: { id: string; author: string; body: string; createdAt: number }
  state: FileThreadsState
  /** Names and avatars for authors. Absent renders shortened keys. */
  people?: People
}) {
  const replies: FileComment[] | undefined =
    state === 'loading' || 'failed' in state ? undefined : state.replies[root.id]

  return (
    <div className="flex flex-col p-4" data-thread={root.id}>
      <CommentRow comment={root} people={people} />
      {/*
        A rule under the root, because the two halves are not the same thing:
        above is what is being answered, below are the answers. Without it a
        thread reads as a flat list whose first item happens to be highlighted
        in the pane to the left. The package's rule, edge to edge (`mx-0`).
      */}
      <Divider className="mx-0 mt-3" />
      <div className="pt-3">
        {state === 'loading' ? (
          <div data-loading="thread">
            <SkeletonSidebarList />
          </div>
        ) : 'failed' in state ? (
          /*
            A read that failed and a comment nobody answered are the same number
            of replies and must not be the same sentence — the distinction
            `FileThreadsState` exists to carry, and the one whose loss rendered
            a CORS-blocked read as eighty-one missing folders.

            A section, not a page (D51): the pane is not empty — the comment
            being answered is above this line.
          */
          <EmptyState scope="section" message="This thread could not be read." />
        ) : !replies?.length ? (
          <EmptyState scope="section" message="No replies yet." />
        ) : (
          <div className="flex flex-col gap-3">
            {replies.map((reply) => (
              <CommentRow key={reply.id} comment={reply} people={people} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
