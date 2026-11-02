import { useState, useEffect } from 'react'
import { AttachmentCard, ReplyCard as KitReplyCard } from '@estiva-app/ui'
import type { Embed } from '@estiva-app/protocol'
import { shareableMessageUrl } from '@/lib/objectUrl'
import { REACTION_OPTIONS, toggledReaction, useRefusedReaction } from '@/lib/reactions'
import { CURRENT_USER_NAME, type ReactionData, type FileAttachment } from '@/api'
import { isCurrentUser } from '@/api'
import { EditBox, type EditSaved } from './ui/ConversationBox'
import { withoutCard } from '@estiva-app/conversation'
import { takeRefusedEdit, useRefusedEdit, type RefusedEdit } from '@/lib/refusedEdits'
import { postedAttachment } from '@/lib/fileAttachments'
import { blobObjectUrl } from '@/nostr/media'
import type { HighlightType } from '@/api'
import { MessageBody } from './ui/MessageBody'
import { formatReplyTimestamp } from '@/api/format'
import { DELETE_NOTE } from './ConversationCard'

interface ReplyCardProps {
  authorName: string
  authorAvatarSrc?: string
  /** An agent wrote it: the kit draws its face as the robot. */
  authorBot?: boolean
  timestamp: string
  /** When it was written, ms: its time then says the exact date and time under the pointer, before "Link to this message" (B10). */
  createdAtMs?: number
  body: string
  /** When the body was last edited, ms — draws the marker (CON-8). */
  editedAt?: number
  /** Offer Edit and Delete (SPEC §6.5). Absent: only on the viewer's own ("You") message. */
  canEditAndDelete?: boolean
  reactions?: ReactionData[]
  /** The reply's highlight, kept through an edit so saving never drops it. Not drawn (Katerina, 1 November). */
  highlightType?: HighlightType
  /** Real uploaded files (rendered as file chips / image thumbnails). */
  files?: FileAttachment[]
  isNew?: boolean
  isUrgent?: boolean
  onDelete?: () => void
  onBodyChange?: (newBody: string) => void
  /**
   * The message's id: an edit of it the relay refused reopens this card's edit box with the saved text (OPT-8), and
   * the kit's card carries it (`data-reply-id`), which a link to it shows and the thread watches to read it (C2, C3).
   */
  messageId?: string
  /** The reply's files after an edit added or removed some — PEE-16. The whole
   *  list, and only when this edit changed it. */
  onFilesChange?: (files: FileAttachment[]) => void
  /** The reply's card set after an edit changed it — OPT-17. */
  onEmbedsChange?: (embeds: Embed[]) => void
  /** The file whose conversation it is in: an edit linking that file adds no card (§13.6.2). */
  writtenOn?: string
  onReactionsChange?: (reactions: ReactionData[], emoji: string) => void
  /** True when this reply triggered the parent conv's resolution (compose `→ msg` in the
   *  thread panel). When set, edit mode surfaces the resolution as a resolutionBlock so
   *  the user can update or remove it inline. */
  ownsResolution?: boolean
  /** Current resolution message on the parent conv. Forwarded into the editor in edit mode. */
  resolutionMsg?: string
  /** Called on save when the editor's resolutionBlock changed:
   *  - resolved=true with new `message` → parent stays/becomes resolved with that message
   *  - resolved=false → parent reopens (user removed the resolution from the editor) */
  onResolutionChange?: (resolved: boolean, message?: string) => void
  /** Whom the body names urgently, by pubkey — the event's `urgent` tags (SPEC §13.1, CON-24). */
  urgentMentions?: string[]
  /** The blocks of other objects the reply shows (SPEC §13.6.1, COM-2). */
  parts?: { address: string; block: string; anchor?: true }[]
  /** The cards its author asked for (SPEC §13.6.2). */
  embeds?: readonly Embed[]
  /** The published event's id. When present the time is the message's permalink (PEE-17). */
  nostrEventId?: string
  /** Show it with no way to change it: no hover menu, reactions not toggleable. An archived file's replies. */
  readOnly?: boolean
  className?: string
}

/**
 * One reply in a thread: the kit's `ReplyCard` (ui 0.96.0), with Peek's own half kept here — the reply read and written
 * through the relay, shown at once, an edit the relay refused opened again, Peek's edit box (which can carry the
 * thread's resolution when this reply gave it) and Peek's words. The time is the reply's permalink once it has an id.
 *
 * @registry namesake: Peek's reply on the relay drawn by the package's ReplyCard, which draws it all.
 */
export function ReplyCard({
  authorName,
  authorAvatarSrc,
  authorBot,
  timestamp,
  createdAtMs,
  body,
  editedAt,
  canEditAndDelete,
  reactions,
  highlightType,
  files,
  isNew = false,
  isUrgent = false,
  onDelete,
  onBodyChange,
  messageId,
  onFilesChange,
  onEmbedsChange,
  writtenOn,
  onReactionsChange,
  ownsResolution = false,
  resolutionMsg,
  onResolutionChange,
  urgentMentions,
  parts,
  embeds,
  nostrEventId,
  readOnly = false,
  className,
}: ReplyCardProps) {
  // A reply exists here the moment it is sent and gains its id only once the relay has it: no link to nothing before then.
  const messageLink = shareableMessageUrl(nostrEventId, window.location.origin)

  const [reactionsState, setReactionsState] = useState<ReactionData[]>(reactions ?? [])
  // Sync local reactions state when the parent passes a new override (e.g. after navigation back).
  useEffect(() => { setReactionsState(reactions ?? []) }, [reactions])
  const refusedReaction = useRefusedReaction(messageId)
  // Refused: the reaction drawn here at once goes, and the relay's view stands — even when that view never changed.
  useEffect(() => {
    if (refusedReaction) setReactionsState(reactions ?? [])
  }, [refusedReaction]) // eslint-disable-line react-hooks/exhaustive-deps
  const [highlightState, setHighlightState] = useState<HighlightType | undefined>(highlightType)

  const [bodyState, setBodyState] = useState(body)
  // Sync body from prop when it changes externally
  useEffect(() => { setBodyState(body) }, [body])
  useEffect(() => { setHighlightState(highlightType) }, [highlightType])
  // Edit mode: the shared box's edit form, a new box per opening, none on a read-only card (PEEKM-4, as ConversationCard).
  const [editing, setEditing] = useState<{ key: number; refused?: RefusedEdit } | null>(null)
  const isEditing = editing !== null && !readOnly

  const handleEditStart = (refused?: RefusedEdit) => setEditing((was) => ({ key: (was?.key ?? 0) + 1, refused }))

  // A refused edit: the old text is back, and the edit box reopens with what was saved and why (OPT-8, as ConversationCard).
  // A read-only card cannot reopen it, so it does not count as drawing the message: the note says so instead.
  const refusedEdit = useRefusedEdit(readOnly ? undefined : messageId)
  useEffect(() => {
    if (refusedEdit === undefined || !messageId || !takeRefusedEdit(messageId)) return
    setBodyState(body)
    if (isEditing) return
    handleEditStart(refusedEdit)
  }, [refusedEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  // Saved: shown at once and handed on in one handler, so the text, files and cards go as one edit (`queueEdit`).
  const handleEditSave = (saved: EditSaved) => {
    if (saved.text !== undefined) {
      setBodyState(saved.text)
      onBodyChange?.(saved.text)
    }
    // Resolution changes flow up when this reply owns the parent's resolution, or now gives it one.
    const { hasResolution, resolutionMessage } = saved.resolution
    if (hasResolution && (!ownsResolution || resolutionMessage !== (resolutionMsg ?? ''))) onResolutionChange?.(true, resolutionMessage)
    else if (!hasResolution && ownsResolution) onResolutionChange?.(false, undefined)
    if (saved.highlightType !== highlightState) {
      setHighlightState(saved.highlightType)
    }
    if (saved.files) onFilesChange?.(saved.files)
    if (saved.embeds) onEmbedsChange?.(saved.embeds)
    setEditing(null)
  }

  // Edit and Delete only on the viewer's own message (SPEC §6.5, SHI-29)
  // when the seam says so; else the author label (PEE-32), as `ConversationCard` reads it.
  const isOwnMessage = canEditAndDelete ?? isCurrentUser(authorName)

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
    <KitReplyCard
      id={messageId}
      author={{ name: authorName, picture: authorAvatarSrc, bot: authorBot }}
      time={timestamp}
      at={createdAtMs}
      timeHref={messageLink ?? undefined}
      timeLabel="Link to this message"
      edited={editedAt ? `Edited ${formatReplyTimestamp(editedAt)}` : undefined}
      files={
        files && files.length > 0
          ? files.map((f, i) => <AttachmentCard key={`${f.sha256 ?? f.name}_${i}`} {...postedAttachment(f)} fetchImage={blobObjectUrl} download data-interactive />)
          : undefined
      }
      reactions={{ reactions: reactionsState, options: REACTION_OPTIONS, nameOf: (name) => name, viewer: CURRENT_USER_NAME, onToggle: readOnly || !onReactionsChange ? undefined : handleReact }}
      reactionRefused={refusedReaction}
      isNew={isNew}
      urgent={isUrgent}
      own={isOwnMessage}
      readOnly={readOnly}
      editing={isEditing}
      onEditingChange={(next) => (next ? handleEditStart() : setEditing(null))}
      editor={(done) =>
        editing && (
          <EditBox
            key={editing.key}
            kind="reply"
            message={{
              body: bodyState,
              urgent: urgentMentions,
              highlightType: highlightState,
              resolution: ownsResolution ? { message: resolutionMsg ?? '' } : undefined,
              files,
              embeds,
            }}
            refused={editing.refused}
            here={writtenOn}
            onSave={handleEditSave}
            onCancel={done}
          />
        )
      }
      onDelete={onDelete}
      deleteNote={DELETE_NOTE}
      // Peek's words, as its reply menu said them.
      editLabel="Edit message"
      className={className}
    >
      <MessageBody
        body={bodyState}
        urgentMentions={urgentMentions}
        parts={parts}
        embeds={embeds}
        authorName={authorName}
        // Words, not pickers, on a card where nothing can be changed: an archived file's conversation, a read-only copy.
        readOnly={readOnly}
        // The author's ✕, offered where Edit is: an edit with that card `none` and every other kept (§13.6.2).
        onRemoveCard={isOwnMessage && !readOnly && onEmbedsChange ? (value) => onEmbedsChange(withoutCard(embeds, value)) : undefined}
      />
    </KitReplyCard>
  )
}
