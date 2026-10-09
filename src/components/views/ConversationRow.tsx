import { memo } from 'react'
import { ConversationCard } from '@/components/ConversationCard'
import type { ConversationData, FileAttachment } from '@/api'

/** What a card in the list does, by the id of the message it draws. */
export interface RowHandlers {
  setResolution: (id: string, resolved: boolean, message?: string) => void
  toggleReaction: (id: string, emoji: string) => void
  editBody: (id: string, body: string) => void
  editFiles: (id: string, files: FileAttachment[]) => void
  onOpenThread: (id: string) => void
  remove: (id: string) => void
}

interface ConversationRowProps {
  c: ConversationData
  hasNewReply: boolean
  isSelected: boolean
  readOnly: boolean
  /** The same object on every render — the view's — so it never re-draws a row by itself. */
  actions: RowHandlers
}

/**
 * One message in a conversation's list (OPT-6). Drawn again only when what it
 * shows changed: the view rebuilds every message's data from the held
 * conversation on each change, so the data is compared by value, not by
 * identity. Without this, one new message re-drew every card of a long topic.
 */
export const ConversationRow = memo(
  function ConversationRow({ c, hasNewReply, isSelected, readOnly, actions }: ConversationRowProps) {
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
        hasNewReply={hasNewReply}
        isResolved={c.isResolved}
        resolvedBy={c.resolvedBy}
        resolutionMessage={c.resolutionMessage}
        nostrReferences={c.nostrReferences}
        urgentMentions={c.urgentMentions}
        parts={c.parts}
        deleted={c.isDeleted}
        isSelected={isSelected}
        onResolvedChange={(resolved, _by, message) => actions.setResolution(c.id, resolved, message)}
        onReactionsChange={(_next, emoji) => actions.toggleReaction(c.id, emoji)}
        onBodyChange={(b) => actions.editBody(c.id, b)}
        onFilesChange={(f) => actions.editFiles(c.id, f)}
        readOnly={readOnly}
        onClick={readOnly && !c.replyCount ? undefined : () => actions.onOpenThread(c.id)}
        onReply={() => actions.onOpenThread(c.id)}
        onDelete={() => actions.remove(c.id)}
        messageId={c.id}
      />
    )
  },
  (before, after) =>
    before.hasNewReply === after.hasNewReply &&
    before.isSelected === after.isSelected &&
    before.readOnly === after.readOnly &&
    before.actions === after.actions &&
    (before.c === after.c || JSON.stringify(before.c) === JSON.stringify(after.c)),
)
