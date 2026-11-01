import { useState, useEffect } from 'react'
import type { Embed } from '@estiva-app/protocol'
import { AttachmentCard, ConversationCard as KitConversationCard } from '@estiva-app/ui'
import { CURRENT_USER_NAME, type ReactionData, type HighlightType, type FileAttachment } from '@/api'
import { isCurrentUser } from '@/api'
import { EditBox, type EditSaved } from './ui/ConversationBox'
import { withoutCard } from '@estiva-app/conversation'
import { MessageBody } from './ui/MessageBody'
import { takeRefusedEdit, useRefusedEdit, type RefusedEdit } from '@/lib/refusedEdits'
import { REACTION_OPTIONS, toggledReaction, useRefusedReaction } from '@/lib/reactions'
import { postedAttachment } from '@/lib/fileAttachments'
import { blobObjectUrl } from '@/nostr/media'
import { formatReplyTimestamp } from '@/api/format'

/** What the delete question says Peek does, under the kit's question: Peek's words, as its own dialog said them. */
export const DELETE_NOTE = 'Peek asks the relay to delete it. The relay decides, and copies held by other apps are unaffected.'

/** Under a message's delete question: what Peek does, then how many replies stay, in Peek's words (ConfirmDelete's). */
function deleteNote(replies: number) {
  return (
    <>
      <p>{DELETE_NOTE}</p>
      {replies > 0 && <p>Its {replies} {replies === 1 ? 'reply is a separate event and stays' : 'replies are separate events and stay'}.</p>}
    </>
  )
}

interface ConversationCardProps {
  authorName: string
  authorAvatarSrc?: string
  timestamp: string
  body: string
  /** When the body was last edited, ms — draws the marker (CON-8). */
  editedAt?: number
  /** Offer Edit and Delete (SPEC §6.5). Absent: only on the viewer's own ("You") message. */
  canEditAndDelete?: boolean
  reactions?: ReactionData[]
  replyCount?: number
  /** Who replied: the replies row's faces. */
  replyAuthors?: { name: string; avatarSrc?: string }[]
  /** Time of the last reply, in the replies row. */
  lastReplyTime?: string
  /** Real uploaded files (rendered as file chips / image thumbnails). */
  files?: FileAttachment[]
  hasNewReply?: boolean
  hasNewMessage?: boolean
  isUrgent?: boolean
  isResolved?: boolean
  resolvedBy?: string
  resolutionMessage?: string
  /**
   * The message's highlight, kept through an edit so saving never drops it. Not drawn: the card shows no highlight
   * (Katerina, 1 November: none until highlights are kept everywhere; the record says "No Highlights").
   */
  highlightType?: HighlightType
  nostrReferences?: string[]
  /** Whom the body names urgently, by pubkey — the event's `urgent` tags (SPEC §13.1, CON-24). */
  urgentMentions?: string[]
  /** The blocks of other objects the message shows (SPEC §13.6.1, COM-2). */
  parts?: { address: string; block: string; anchor?: true }[]
  /** The cards its author asked for (SPEC §13.6.2). */
  embeds?: readonly Embed[]
  /** The address of the file it is shown on ("Mentioned in"): no card for that file under it, only its chip (WID-3). */
  here?: string
  /** The file whose conversation it is in: an edit linking that file adds no card (§13.6.2). */
  writtenOn?: string
  /** Which block of the referenced object this is about — SPEC §13.6. */
  nostrBlockId?: string
  /** An edit changed the highlight it carries (the edit box keeps one; nothing here sets one). */
  onHighlightChange?: (type: HighlightType | undefined) => void
  onBodyChange?: (body: string) => void
  /** The message's id: an edit of it the relay refused reopens this card's edit box with the saved text (OPT-8). */
  messageId?: string
  /** The message's files after an edit added or removed some — PEE-16. The
   *  whole list, and only when this edit changed it. */
  onFilesChange?: (files: FileAttachment[]) => void
  /** The message's card set after an edit changed it — OPT-17. `none` for each card taken away. */
  onEmbedsChange?: (embeds: Embed[]) => void
  onResolvedChange?: (resolved: boolean, resolvedBy?: string, message?: string) => void
  onReactionsChange?: (reactions: ReactionData[], emoji: string) => void
  onDelete?: () => void
  isSelected?: boolean
  onReply?: () => void
  onClick?: () => void
  /** Show it with no way to change it: no hover menu, reactions not toggleable.
   *  An archived file's messages. Opening the thread still works. */
  readOnly?: boolean
  /** It was deleted and its replies stay (PER-24): said in place of the author
   *  and body, read-only, and still opens its thread. */
  deleted?: boolean
  /** What the delete question calls it: Peek's "message", everywhere, as it always said (Katerina, 1 November: keep Peek's words). */
  noun?: string
  className?: string
}

/**
 * One message in a file's conversation or a direct message: the kit's `ConversationCard` (one conversation in every
 * app, ui 0.96.0), with Peek's own half kept here — the message read and written through the relay, shown at once
 * (reactions, edits, a resolve), an edit the relay refused opened again, Peek's edit box and Peek's words.
 *
 * @registry namesake: Peek's message on the relay drawn by the package's ConversationCard, which draws it all.
 */
export function ConversationCard({
  authorName,
  authorAvatarSrc,
  timestamp,
  body,
  editedAt,
  canEditAndDelete,
  reactions,
  replyCount,
  replyAuthors,
  lastReplyTime,
  files,
  hasNewReply = false,
  hasNewMessage = false,
  isUrgent = false,
  isResolved: initialResolved = false,
  resolvedBy: initialResolvedBy = '',
  resolutionMessage: initialResolutionMessage = '',
  nostrReferences,
  urgentMentions,
  parts,
  embeds,
  here,
  writtenOn,
  nostrBlockId,
  highlightType,
  onHighlightChange,
  onBodyChange,
  messageId,
  onFilesChange,
  onEmbedsChange,
  onResolvedChange,
  onReactionsChange,
  onDelete,
  isSelected,
  onReply,
  onClick,
  readOnly: readOnlyProp = false,
  deleted = false,
  noun = 'message',
  className,
}: ConversationCardProps) {
  const readOnly = readOnlyProp || deleted

  // Reactions, shown at once and handed on.
  const [reactionsState, setReactionsState] = useState<ReactionData[]>(reactions ?? [])
  const refusedReaction = useRefusedReaction(messageId)
  // Refused: the reaction drawn here at once goes, and the relay's view stands — even when that view never changed.
  useEffect(() => {
    if (refusedReaction) setReactionsState(reactions ?? [])
  }, [refusedReaction]) // eslint-disable-line react-hooks/exhaustive-deps
  // Sync local reaction state if the parent passes a different override (e.g. after navigation back).
  useEffect(() => {
    setReactionsState(reactions ?? [])
  }, [reactions])

  // The highlight a message carries, kept through an edit.
  const [highlightState, setHighlightState] = useState<HighlightType | undefined>(highlightType)

  // Body - mutable after edit
  const [bodyState, setBodyState] = useState(body)
  // An edit made elsewhere reaches the card as a new `body`: a copy shown
  // somewhere else (Activity's mention row, PEE-48) kept the first text.
  useEffect(() => {
    setBodyState(body)
  }, [body])

  /*
    Edit mode: the shared box's edit form (PEEKM-4), drawn by the kit's card in its place while editing. `editing` is
    what it opens with — the message, or a save the relay refused (OPT-8) — and `editKey` makes each opening a new box,
    since the box reads what it opens with only as it mounts. A read-only card draws no box.
  */
  const [editing, setEditing] = useState<{ key: number; refused?: RefusedEdit } | null>(null)
  const isEditing = editing !== null && !readOnly

  // Resolved state - sync from parent when prop changes
  const [resolved, setResolved] = useState(initialResolved)
  const [resolvedBy, setResolvedBy] = useState(initialResolvedBy)
  const [resolutionMsg, setResolutionMsg] = useState(initialResolutionMessage)

  useEffect(() => {
    setResolved(initialResolved)
  }, [initialResolved])

  useEffect(() => {
    setResolvedBy(initialResolvedBy)
  }, [initialResolvedBy])

  useEffect(() => {
    setResolutionMsg(initialResolutionMessage)
  }, [initialResolutionMessage])

  const handleResolve = (message: string) => {
    setResolved(true)
    setResolvedBy('You')
    setResolutionMsg(message)
    onResolvedChange?.(true, 'You', message)
  }

  const handleReopen = () => {
    setResolved(false)
    setResolvedBy('')
    setResolutionMsg('')
    onResolvedChange?.(false)
  }

  // Edit and Delete only on the viewer's own message (SPEC §6.5, SHI-29): a
  // seam that knows the viewer says so in `canEditAndDelete`. One that does
  // not falls back to the author label (PEE-32) — every seam maps the
  // viewer's own rows to `CURRENT_USER_NAME`, the same label "You" reads.
  const isOwnMessage = canEditAndDelete ?? isCurrentUser(authorName)

  const handleEditStart = (refused?: RefusedEdit) => setEditing((was) => ({ key: (was?.key ?? 0) + 1, refused }))

  /*
    An edit the relay refused (OPT-8): the message shows its old text again,
    and its edit box reopens holding what was saved, with why under it (Miky,
    9 Oct) — now, or when this card is next drawn if the person had moved on.
    A box already open again is left as the person has it.
  */
  // A read-only card cannot reopen it, so it does not count as drawing the message: the note says so instead.
  const refusedEdit = useRefusedEdit(readOnly ? undefined : messageId)
  useEffect(() => {
    if (refusedEdit === undefined || !messageId || !takeRefusedEdit(messageId)) return
    setBodyState(body)
    if (isEditing) return
    handleEditStart(refusedEdit)
  }, [refusedEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  /*
    Saved: shown at once, and handed on in one handler, so the conversation
    folds the text, the files and the cards into one edit (`queueEdit`). The
    resolution is its own write, sent only when the edit changed it.
  */
  const handleEditSave = (saved: EditSaved) => {
    if (saved.text !== undefined) {
      setBodyState(saved.text)
      onBodyChange?.(saved.text)
    }
    const { hasResolution, resolutionMessage } = saved.resolution
    if (hasResolution && (!resolved || resolutionMessage !== resolutionMsg)) {
      setResolved(true)
      setResolvedBy('You')
      setResolutionMsg(resolutionMessage)
      onResolvedChange?.(true, 'You', resolutionMessage)
    } else if (!hasResolution && resolved) {
      // The block taken out of the box reopens the conversation.
      setResolved(false)
      setResolvedBy('')
      setResolutionMsg('')
      onResolvedChange?.(false, undefined, undefined)
    }
    if (saved.highlightType !== highlightState) {
      setHighlightState(saved.highlightType)
      onHighlightChange?.(saved.highlightType)
    }
    if (saved.files) onFilesChange?.(saved.files)
    if (saved.embeds) onEmbedsChange?.(saved.embeds)
    setEditing(null)
  }

  const handleReact = (emoji: string) => {
    // Computed from the state in hand, not inside a state updater: React runs
    // updaters during render, and telling the parent from there set state in
    // another component mid-render — a warning on every reaction until
    // 2026-09-10 (PEEK-ADOPTION.md §11.5).
    const next = toggledReaction(reactionsState, emoji)
    setReactionsState(next)
    onReactionsChange?.(next, emoji)
  }

  return (
    <KitConversationCard
      author={{ name: authorName, picture: authorAvatarSrc }}
      time={timestamp}
      edited={editedAt ? `Edited ${formatReplyTimestamp(editedAt)}` : undefined}
      files={
        files && files.length > 0
          ? files.map((f, i) => <AttachmentCard key={`${f.sha256 ?? f.name}_${i}`} {...postedAttachment(f)} fetchImage={blobObjectUrl} download data-interactive />)
          : undefined
      }
      reactions={{ reactions: reactionsState, options: REACTION_OPTIONS, nameOf: (name) => name, viewer: CURRENT_USER_NAME, onToggle: onReactionsChange ? handleReact : undefined }}
      reactionRefused={refusedReaction}
      isNew={hasNewMessage}
      urgent={isUrgent}
      own={isOwnMessage}
      readOnly={readOnlyProp}
      deleted={deleted}
      editing={isEditing}
      onEditingChange={(next) => (next ? handleEditStart() : setEditing(null))}
      editor={(done) =>
        editing && (
          <EditBox
            key={editing.key}
            message={{
              body: bodyState,
              urgent: urgentMentions,
              highlightType: highlightState,
              resolution: resolved ? { message: resolutionMsg } : undefined,
              files,
              embeds,
            }}
            refused={editing.refused}
            here={writtenOn}
            onSave={handleEditSave}
            onCancel={done}
            className="flex-1 min-w-0"
          />
        )
      }
      onDelete={onDelete}
      deleteNote={deleteNote(replyCount ?? 0)}
      noun={noun}
      // Peek's ⋯ menu as it read (Katerina, 1 November): its heading, the key that resolves from its box, "Edit message".
      // Not the highlights; not Open work and View details, which no Peek page ever gave an action (her call, the same day).
      menuLabel="Utilities"
      resolveHint="->"
      editLabel="Edit message"
      replies={replyCount ? { count: replyCount, faces: replyAuthors?.map((who) => ({ name: who.name, picture: who.avatarSrc })), last: lastReplyTime, isNew: hasNewReply } : undefined}
      onReply={onReply}
      resolved={resolved ? { by: resolvedBy || 'Someone', note: resolutionMsg || undefined } : undefined}
      onResolve={handleResolve}
      onReopen={handleReopen}
      selected={isSelected}
      onClick={onClick}
      className={className}
    >
      <MessageBody
        body={bodyState}
        nostrReferences={nostrReferences}
        nostrBlockId={nostrBlockId}
        urgentMentions={urgentMentions}
        parts={parts}
        embeds={embeds}
        authorName={authorName}
        here={here}
        // Words, not pickers, on a card where nothing can be changed: an archived file's conversation, a read-only copy.
        readOnly={readOnly}
        // The author's ✕, offered where Edit is: an edit with that card `none` and every other kept (§13.6.2).
        onRemoveCard={isOwnMessage && !readOnly && onEmbedsChange ? (value) => onEmbedsChange(withoutCard(embeds, value)) : undefined}
      />
    </KitConversationCard>
  )
}
