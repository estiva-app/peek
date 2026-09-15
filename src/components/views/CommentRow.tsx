import type { ReactNode } from 'react'
import type { People } from '@estiva-app/interop'
import { useIsTopicResolved } from '@/api'
import { Avatar } from '@/components/ui/Avatar'
import { WithTooltip } from '@estiva-app/ui'
import { MessageBody } from '@/components/ui/MessageBody'
import { whenLabel } from '@/components/ui/ActivityTimeline'

/** The part of a comment this row draws. Both panes' shapes satisfy it. */
export interface DrawableComment {
  id: string
  author: string
  body: string
  /** Nostr seconds. */
  createdAt: number
}

/**
 * One comment, owned by whichever app wrote it — the row the conversation pane
 * and the thread pane both draw.
 *
 * Lifted out of `ForeignConversationView` by FOL-19, unchanged, because a reply
 * and the comment it answers must be the same object on screen: they are the
 * same kind of thing, and drawing them differently would say they are not.
 *
 * **Not `ThreadReplyCard`.** That component is Peek's own message — a tiptap
 * editor, reactions, attachments, resolutions, deletion. None of it applies to
 * a comment owned by another app, which this viewer cannot edit here and should
 * not be offered controls for ("only offer actions that can succeed"). So this
 * reuses `MessageBody`, which is the part that is genuinely shared: the body,
 * its inline marks, and any `nostr:naddr…` it references.
 */
export function CommentRow({
  comment,
  people,
  actions,
  below,
  className,
}: {
  comment: DrawableComment
  /** Names and avatars for comment authors. Absent renders shortened keys. */
  people?: People
  /** Drawn at the row's right edge, on the name's line. */
  actions?: ReactNode
  /**
   * Drawn under the body, indented with it — where what a message *has* goes,
   * as against what you can do to it. Peek's own messages put their reply row
   * here for the same reason: a thread belongs to the message it hangs from,
   * and a control at the far right of the header reads as neither (FOL-25).
   */
  below?: ReactNode
  className?: string
}) {
  const isTopicResolved = useIsTopicResolved()
  const profile = people?.[comment.author]
  /*
    A shortened key, not "Unknown". Whoever wrote this has an identity even when
    no kind:0 has been published for it, and the key is how the person reading
    can tell two unnamed authors apart — which "Unknown" twice cannot.
  */
  const name = profile?.displayName ?? `${comment.author.slice(0, 8)}…`
  // Nostr seconds; `whenLabel` and `Date` both want milliseconds.
  const at = comment.createdAt * 1000

  return (
    <article className={className} data-comment={comment.id}>
      <div className="flex gap-2">
        <Avatar src={profile?.picture} name={name} size={24} />
        <div className="min-w-0 flex-1">
          <header className="flex items-baseline gap-2">
            <span className="text-body-2-strong text-text-primary">{name}</span>
            {/* The package's tooltip, not the browser's (§4.9): it waits the
                shared 300ms, fades, and shows on keyboard focus. */}
            <WithTooltip
              label={new Date(at).toLocaleString(undefined, {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            >
              <time className="text-caption text-text-muted" dateTime={new Date(at).toISOString()}>
                {whenLabel(at)}
              </time>
            </WithTooltip>
            {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
          </header>
          <MessageBody body={comment.body} isTopicResolved={isTopicResolved} />
          {below && <div className="mt-1 flex items-center gap-2">{below}</div>}
        </div>
      </div>
    </article>
  )
}
