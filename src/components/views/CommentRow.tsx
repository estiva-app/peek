import type { People } from '@estiva-app/interop'
import { ConversationCard, ReplyCard, WithTooltip } from '@estiva-app/ui'
import { MessageBody } from '@/components/ui/MessageBody'
import { whenLabel } from '@/components/ui/ActivityTimeline'

/** The part of a comment this row draws. Both panes' shapes satisfy it. */
export interface DrawableComment {
  id: string
  author: string
  body: string
  /** Nostr seconds. */
  createdAt: number
  /** A comment deleted under its replies (PER-24): drawn as a line saying so, no author and no body. */
  deleted?: boolean
}

/**
 * Who wrote it: a shortened key, not "Unknown", when they published no name. Whoever wrote it has an identity even
 * then, and the key is how the person reading can tell two unnamed authors apart — which "Unknown" twice cannot.
 */
function authorOf(comment: DrawableComment, people?: People) {
  const profile = people?.[comment.author]
  return { name: profile?.displayName ?? `${comment.author.slice(0, 8)}…`, picture: profile?.picture, bot: profile?.bot === true }
}

/** Its time, short, with the whole date and time in the package's tooltip (§4.9), as the row always said it. */
function When({ seconds }: { seconds: number }) {
  // Nostr seconds; `whenLabel` and `Date` both want milliseconds.
  const at = seconds * 1000
  return (
    <WithTooltip label={new Date(at).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}>
      <time dateTime={new Date(at).toISOString()}>{whenLabel(at)}</time>
    </WithTooltip>
  )
}

/**
 * One comment owned by another app, in Peek: the kit's `ConversationCard`, the one conversation of every app (Katerina,
 * 1 November). Nothing on it changes it — this viewer cannot edit, resolve or react to another app's comment here, and
 * should not be offered controls for it ("only offer actions that can succeed"). What it offers is its thread: the
 * replies row, which says the word "replies" next to the body it belongs to (FOL-25: a bare count read as a timestamp,
 * and readers took the page for flat), a press anywhere on it, and Reply on hover, the true offer when it has none.
 */
export function CommentRow({
  comment,
  people,
  replies,
  isNew = false,
  selected,
  onOpen,
}: {
  comment: DrawableComment
  /** Names and avatars for comment authors. Absent renders shortened keys. */
  people?: People
  /** How many replies, when they were asked for: never a nought, which would be an assertion nobody made. */
  replies?: number
  /** A reply not read yet: the replies row's "1 new". */
  isNew?: boolean
  /** Its thread is the one open beside it: the card is marked, so the pane on the right has a visible origin. */
  selected?: boolean
  /** Opens its thread. Absent (the comment a thread answers), it opens nothing and offers nothing. */
  onOpen?: () => void
}) {
  return (
    // One article per comment, its id on it, and the one whose thread is open marked current, as the row always was.
    <article data-comment={comment.id} data-deleted={comment.deleted ? '' : undefined} aria-current={selected || undefined}>
      <ConversationCard
        author={authorOf(comment, people)}
        time={<When seconds={comment.createdAt} />}
        deleted={comment.deleted}
        readOnly={!onOpen}
        // The replies row is a button of its own, as the count was: reached by the keyboard, it opens the thread.
        replies={replies ? { count: replies, isNew, onOpen } : undefined}
        onReply={onOpen}
        onClick={onOpen}
        selected={selected}
      >
        <MessageBody body={comment.body} />
      </ConversationCard>
    </article>
  )
}

/** A reply in another app's thread, in Peek: the kit's `ReplyCard`, with nothing to change it, as `CommentRow`. */
export function CommentReply({ comment, people }: { comment: DrawableComment; people?: People }) {
  return (
    <ReplyCard author={authorOf(comment, people)} time={<When seconds={comment.createdAt} />} readOnly>
      <MessageBody body={comment.body} />
    </ReplyCard>
  )
}
