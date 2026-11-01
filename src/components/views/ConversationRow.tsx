import { memo } from 'react'
import { ConversationCard } from '@/components/ConversationCard'
import type { ConversationData, FileAttachment } from '@/api'
import type { Embed } from '@estiva-app/protocol'

/** What a card in the list does, by the id of the message it draws. */
export interface RowHandlers {
  setResolution: (id: string, resolved: boolean, message?: string) => void
  toggleReaction: (id: string, emoji: string) => void
  editBody: (id: string, body: string) => void
  editFiles: (id: string, files: FileAttachment[]) => void
  /** The card set after an edit, when it changed (OPT-17). */
  editEmbeds: (id: string, embeds: Embed[]) => void
  onOpenThread: (id: string) => void
  remove: (id: string) => void
}

interface ConversationRowProps {
  c: ConversationData
  /** New to you as it was drawn, and not seen yet (Katerina, 30 October). */
  hasNewMessage: boolean
  hasNewReply: boolean
  /** What is new in it is urgent for you: the unread look in its urgent tone. */
  isUrgent: boolean
  isSelected: boolean
  readOnly: boolean
  /** The same object on every render — the view's — so it never re-draws a row by itself. */
  actions: RowHandlers
  /** The file whose conversation this is: an edit linking it adds no card (§13.6.2). */
  writtenOn?: string
}

/**
 * One message in a conversation's list (OPT-6). Drawn again only when what it
 * shows changed: the view rebuilds every message's data from the held
 * conversation on each change, so the data is compared by value, not by
 * identity. Without this, one new message re-drew every card of a long topic.
 */
export const ConversationRow = memo(
  function ConversationRow({ c, hasNewMessage, hasNewReply, isUrgent, isSelected, readOnly, actions, writtenOn }: ConversationRowProps) {
    return (
      <ConversationCard
        authorName={c.authorName}
        authorAvatarSrc={c.authorAvatarSrc}
        timestamp={c.timestamp}
        body={c.body}
        editedAt={c.editedAt}
        canEditAndDelete={c.canEditAndDelete}
        files={c.files}
        reactions={c.reactions}
        replyCount={c.replyCount}
        replyAuthors={c.replyAuthors}
        lastReplyTime={c.lastReplyTime}
        hasNewMessage={hasNewMessage}
        hasNewReply={hasNewReply}
        isUrgent={isUrgent}
        isResolved={c.isResolved}
        resolvedBy={c.resolvedBy}
        resolutionMessage={c.resolutionMessage}
        nostrReferences={c.nostrReferences}
        urgentMentions={c.urgentMentions}
        parts={c.parts}
        embeds={c.embeds}
        deleted={c.isDeleted}
        isSelected={isSelected}
        onResolvedChange={(resolved, _by, message) => actions.setResolution(c.id, resolved, message)}
        onReactionsChange={(_next, emoji) => actions.toggleReaction(c.id, emoji)}
        onBodyChange={(b) => actions.editBody(c.id, b)}
        onFilesChange={(f) => actions.editFiles(c.id, f)}
        onEmbedsChange={(e) => actions.editEmbeds(c.id, e)}
        writtenOn={writtenOn}
        readOnly={readOnly}
        onClick={readOnly && !c.replyCount ? undefined : () => actions.onOpenThread(c.id)}
        onReply={() => actions.onOpenThread(c.id)}
        onDelete={() => actions.remove(c.id)}
        messageId={c.id}
      />
    )
  },
  (before, after) =>
    before.hasNewMessage === after.hasNewMessage &&
    before.hasNewReply === after.hasNewReply &&
    before.isUrgent === after.isUrgent &&
    before.isSelected === after.isSelected &&
    before.readOnly === after.readOnly &&
    before.actions === after.actions &&
    before.writtenOn === after.writtenOn &&
    (before.c === after.c || JSON.stringify(before.c) === JSON.stringify(after.c)),
)
