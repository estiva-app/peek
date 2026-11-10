import type { ForeignObject, People } from '@estiva-app/interop'
import type { ForeignConversationState } from '@/api'
import { EmptyState, SkeletonList } from '@estiva-app/ui'
import { CommentRow, type DrawableComment } from '@/components/views/CommentRow'

/** The box the comments live in, written once: the comments, or the line that says why there are none. */
const COMMENTS = 'flex flex-col gap-1 p-4'

/**
 * One file's conversation, drawn by Peek, owned by somebody else — RFC 0.5 §10.
 *
 * **The view that makes facets unnecessary.** §10.2 gives a file three parts —
 * document, properties, conversation — and says each app renders the ones it
 * owns. This is Peek's aspect of a file it does not own: the conversation, and
 * nothing else. The document is Leaf's and the properties are Ship's, so the
 * card above this panel keeps drawing those and this draws only the discussion.
 *
 * **It renders every app's the same way.** No kind number appears here, exactly
 * as in `FolderContentsView`: the comment kinds were chosen by the owning app's
 * manifest before the read, so a Ship project, a Ship issue and a file from an
 * app nobody has written yet all arrive as `object.comments` and draw
 * identically. That sameness *is* the claim being tested — if this needed a
 * branch per app, aspects would not be a model.
 *
 * **Not `ReplyCard`.** That component is Peek's own message: a tiptap
 * editor, reactions, attachments, resolutions, deletion. None of it applies to a
 * comment owned by another app, which this viewer cannot edit here and should
 * not be offered controls for — "only offer actions that can succeed". So this
 * reuses `MessageBody`, which is the part that is genuinely shared: the body,
 * its inline marks, and any `nostr:naddr…` it references.
 */
export function ForeignConversationView({
  state,
  people,
  onOpenThread,
  openThreadId,
  replyCounts,
  newReplies,
  deletedRoots,
}: {
  state: ForeignConversationState
  /** Names and avatars for comment authors. Absent renders shortened keys. */
  people?: People
  /**
   * Open this comment's thread. Omit and no row offers one — the manner this
   * view had before FOL-19, and still the right one inside a topic's own
   * conversation, where there is no third pane to open into.
   */
  onOpenThread?: (commentId: string) => void
  /** The comment whose thread is open beside this pane, if any. */
  openThreadId?: string
  /**
   * Replies per comment id. A **missing** entry draws no count, on the same
   * terms as the listing's badges: nobody asked, which is not the same as none.
   * A reply carries no `a` tag, so it is never in `state.comments` and the
   * number cannot be derived here.
   */
  replyCounts?: Record<string, number>
  /**
   * Comments whose thread holds a reply new to the viewer: opening the file
   * does not read it, opening the thread does (CON-34), so the row says so, as
   * Peek's own view's replies row does.
   */
  newReplies?: ReadonlySet<string>
  /**
   * Comments deleted under their replies (PER-24): each drawn where it stood,
   * as a line saying so, with its thread still there to open. From the thread
   * read — the conversation no longer holds them.
   */
  deletedRoots?: readonly { id: string; createdAt: number; unseen?: true }[]
}) {
  if (state === 'loading') {
    return (
      <div className="p-4" data-loading="foreign-conversation">
        <SkeletonList />
      </div>
    )
  }

  /*
    A read that failed and a file nobody has commented on are the same number of
    messages and must not be the same sentence.

    Both unreadable cases land here rather than falling through to "No messages
    yet", which is the whole reason `unresolved` exists as a state instead of
    being folded into an absent object. Getting this wrong is not a cosmetic
    bug: it is an assertion that a conversation is empty on the strength of a
    request that never arrived, which is exactly how a CORS-blocked read
    rendered as eighty-one missing folders.
  */
  /*
    A section, not a page (D51). The pane around this is not empty — it has the
    file's name and the app it lives in in its header — so this is a region
    inside a populated pane, and the rule sends that to the line alone, top
    left, no icon and no centring. A `page` state centred an illustration in
    the body of a pane that was already saying what it was about (Katerina,
    2026-09-11). It sits in the comments' own box, so their inset places it.
  */
  if (state === 'unresolved' || 'failed' in state) {
    return (
      <div className={COMMENTS}>
        <EmptyState scope="section" message="This conversation could not be read." />
      </div>
    )
  }

  const object = state as ForeignObject
  /*
    Oldest first, because this is a conversation and not a history: a change
    log reads newest-first, a conversation the other way, and the resolved
    order is the relay's, which is neither.
  */
  const live = new Set(object.comments.map((c) => c.id))
  const standIns: DrawableComment[] = (deletedRoots ?? [])
    .filter((d) => !live.has(d.id))
    .map((d) => ({ id: d.id, author: '', body: '', createdAt: d.createdAt, ...(d.unseen ? { unseen: true } : { deleted: true }) }))
  const comments: DrawableComment[] = [...object.comments, ...standIns].sort((a, b) => a.createdAt - b.createdAt)

  if (comments.length === 0) {
    // Where the first comment would be: in the comments' box, never padded itself (Katerina, 2026-09-14).
    return (
      <div className={COMMENTS}>
        <EmptyState scope="section" message="Nothing said about this yet." />
      </div>
    )
  }

  return (
    <div
      className={COMMENTS}
      data-foreign-conversation={object.ref}
      data-app={object.appName}
    >
      {comments.map((comment) => {
        const replies = replyCounts?.[comment.id]
        return (
          <CommentRow
            key={comment.id}
            comment={comment}
            ownFile={object.address ? [object.address] : undefined}
            people={people}
            /*
              Its replies, spelled out under the body (FOL-25: an unlabelled count at the far right read as a timestamp,
              and readers took nine conversations for flat). A count only when we have one, and never a nought: an
              absence means the replies were not asked for. With none, Reply on hover opens the thread, the only way to
              start one. The open thread marks its comment, so the pane on the right has a visible origin.
            */
            replies={replies}
            isNew={newReplies?.has(comment.id)}
            selected={openThreadId === comment.id}
            onOpen={onOpenThread && (() => onOpenThread(comment.id))}
          />
        )
      })}
    </div>
  )
}
