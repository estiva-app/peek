import type { ForeignObject, People } from '@estiva-app/interop'
import type { ForeignConversationState } from '@/api'
import { useIsTopicResolved } from '@/api'
import { Avatar } from '@/components/ui/Avatar'
import { EmptyState } from '@/components/ui/EmptyState'
import { MessageBody } from '@/components/ui/MessageBody'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { whenLabel } from '@/components/ui/ActivityTimeline'

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
 * **Not `ThreadReplyCard`.** That component is Peek's own message: a tiptap
 * editor, reactions, attachments, resolutions, deletion. None of it applies to a
 * comment owned by another app, which this viewer cannot edit here and should
 * not be offered controls for — "only offer actions that can succeed". So this
 * reuses `MessageBody`, which is the part that is genuinely shared: the body,
 * its inline marks, and any `nostr:naddr…` it references.
 */
export function ForeignConversationView({
  state,
  people,
}: {
  state: ForeignConversationState
  /** Names and avatars for comment authors. Absent renders shortened keys. */
  people?: People
}) {
  const isTopicResolved = useIsTopicResolved()

  if (state === 'loading') {
    return (
      <div className="p-4" data-loading="foreign-conversation">
        <SkeletonSidebarList />
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
  if (state === 'unresolved' || 'failed' in state) {
    return <EmptyState message="This conversation could not be read." />
  }

  const object = state as ForeignObject
  /*
    Oldest first, because this is a conversation and not a history.

    `ActivityTimeline` orders a change log newest-first — the last thing that
    happened is the thing you want. A conversation is read the other way, and
    the resolved order is the relay's, which is neither.
  */
  const comments = [...object.comments].sort((a, b) => a.createdAt - b.createdAt)

  if (comments.length === 0) {
    return <EmptyState message="Nothing said about this yet." />
  }

  return (
    <div
      className="flex flex-col gap-3 p-4"
      data-foreign-conversation={object.ref}
      data-app={object.appName}
    >
      {comments.map((comment) => {
        const profile = people?.[comment.author]
        /*
          A shortened key, not "Unknown". Whoever wrote this has an identity even
          when no kind:0 has been published for it, and the key is how the person
          reading can tell two unnamed authors apart — which "Unknown" twice
          cannot.
        */
        const name = profile?.displayName ?? `${comment.author.slice(0, 8)}…`
        // Nostr seconds; `whenLabel` and `Date` both want milliseconds.
        const at = comment.createdAt * 1000
        return (
          <article key={comment.id} className="flex gap-2" data-comment={comment.id}>
            <Avatar src={profile?.picture} name={name} size={24} />
            <div className="min-w-0 flex-1">
              <header className="flex items-baseline gap-2">
                <span className="text-body-2-strong text-text-primary">{name}</span>
                <time
                  className="text-caption text-text-muted"
                  dateTime={new Date(at).toISOString()}
                  title={new Date(at).toLocaleString(undefined, {
                    dateStyle: 'long',
                    timeStyle: 'short',
                  })}
                >
                  {whenLabel(at)}
                </time>
              </header>
              <MessageBody body={comment.body} isTopicResolved={isTopicResolved} />
            </div>
          </article>
        )
      })}
    </div>
  )
}
