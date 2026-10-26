import { useState, useEffect } from 'react'
import type { Embed } from '@estiva-app/protocol'
import {
  IconAlertSquareRounded,
  IconChecks,
  IconArrowNarrowRight,
  IconDotsVertical,
} from '@tabler/icons-react'
import { AttachmentCard, Avatar, Card, ToolbarButton } from '@estiva-app/ui'
import { RepliesRow } from './ui/RepliesRow'
import { Reaction as ReactionPill } from './ui/Reaction'
import { ConversationQuickMenu } from './ConversationQuickMenu'
import { ConversationMoreMenu } from './ConversationMoreMenu'
import { ResolveDialog } from './ResolveDialog'
import { ConfirmDelete } from './ConfirmDelete'
import { type ReactionData, type HighlightType, type FileAttachment } from '@/api'
import { isCurrentUser } from '@/api'
import { EditBox, type EditSaved } from './ui/ConversationBox'
import { withoutCard } from '@estiva-app/conversation'
import { HighlightPill } from './ui/HighlightPill'
import { EditedMarker } from './ui/EditedMarker'
import { MessageBody } from './ui/MessageBody'
import { UnreadDot } from './ui/UnreadDot'
import { cn } from '@/lib/utils'
import { takeRefusedEdit, useRefusedEdit, type RefusedEdit } from '@/lib/refusedEdits'
import { postedAttachment } from '@/lib/fileAttachments'
import { blobObjectUrl } from '@/nostr/media'
import { MetaText } from '@/components/ui/MetaText'

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
  /** Reply-author names for the signal theme's facepile reply row (ignored elsewhere). */
  replyAuthors?: { name: string; avatarSrc?: string }[]
  /** Time of the last reply, shown in the signal theme's reply row (ignored elsewhere). */
  lastReplyTime?: string
  /** Figma frame ids attached to the message (rendered as preview cards). */
  /** Real uploaded files (rendered as file chips / image thumbnails). */
  files?: FileAttachment[]
  hasNewReply?: boolean
  hasNewMessage?: boolean
  isUrgent?: boolean
  isResolved?: boolean
  resolvedBy?: string
  resolutionMessage?: string
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
  /** Draw it as secondary — Activity's mentions, which do not carry a sub-file
   *  thread's trust (CON-11). The hairline alone, no fill, as Ship draws one. */
  subdued?: boolean
  onReply?: () => void
  onClick?: () => void
  onMore?: () => void
  /** Show it with no way to change it: no hover menu, reactions not toggleable.
   *  A Convex topic's messages since CON-8. Opening the thread still works. */
  readOnly?: boolean
  /** It was deleted and its replies stay (PER-24): said in place of the author
   *  and body, read-only, and still opens its thread. */
  deleted?: boolean
  className?: string
}

/**
 * One message in a topic or direct message, with its author, text, files,
 * reactions and replies, and a hover menu to react, reply, resolve or edit.
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
  isSelected = false,
  subdued = false,
  onReply,
  onClick,
  onMore,
  readOnly: readOnlyProp = false,
  deleted = false,
  className,
}: ConversationCardProps) {
  const readOnly = readOnlyProp || deleted
  const [isHovered, setIsHovered] = useState(false)
  // The ⋯ menu: the quick-menu's measured rect, or closed. The shared Menu
  // shell owns placement and every exit (2026-09-03).
  /* Not a rect any more, only whether the menu is open: the ⋯ menu owns its
     own button since `@estiva-app/ui` 0.10.0. The card still needs to know,
     because a card with an open menu does not react to a stray click. */
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)

  // Reactions. The picker is the quick menu's now — the package Popover above
  // the strip (§4.1, D30, 2026-09-10); the card only needs to know it is open.
  const [reactionsState, setReactionsState] = useState<ReactionData[]>(reactions ?? [])
  const [pickerOpen, setPickerOpen] = useState(false)

  // Sync local reaction state if the parent passes a different override (e.g. after navigation back).
  useEffect(() => {
    setReactionsState(reactions ?? [])
  }, [reactions])

  // Highlight
  const [highlightState, setHighlightState] = useState<HighlightType | undefined>(highlightType)

  // Body - mutable after edit
  const [bodyState, setBodyState] = useState(body)
  // An edit made elsewhere reaches the card as a new `body`: a copy shown
  // somewhere else (Activity's mention row, PEE-48) kept the first text.
  useEffect(() => {
    setBodyState(body)
  }, [body])

  /*
    Edit mode: the shared box's edit form (PEEKM-4), drawn only while editing.
    `editing` is what it opens with — the message, or a save the relay refused
    (OPT-8) — and `editKey` makes each opening a new box, since the box reads
    what it opens with only as it mounts. A read-only card (an archived file,
    a deleted message) draws no box, even one opened before it became so.
  */
  const [editing, setEditing] = useState<{ key: number; refused?: RefusedEdit } | null>(null)
  const isEditing = editing !== null && !readOnly

  // Resolved state - sync from parent when prop changes
  const [resolved, setResolved] = useState(initialResolved)
  const [resolvedBy, setResolvedBy] = useState(initialResolvedBy)
  const [resolutionMsg, setResolutionMsg] = useState(initialResolutionMessage)
  const [showResolveDialog, setShowResolveDialog] = useState(false)

  useEffect(() => {
    setResolved(initialResolved)
  }, [initialResolved])

  useEffect(() => {
    setResolvedBy(initialResolvedBy)
  }, [initialResolvedBy])

  useEffect(() => {
    setResolutionMsg(initialResolutionMessage)
  }, [initialResolutionMessage])



  const handleResolveConfirm = (message: string) => {
    setResolved(true)
    setResolvedBy('You')
    setResolutionMsg(message)
    setShowResolveDialog(false)
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

  // Delete asks first (D56): the menu row opens the question, the delete runs on Yes.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const handleDelete = () => setConfirmingDelete(true)

  const handleConvHighlight = (type: HighlightType | undefined) => {
    setHighlightState(type)
    onHighlightChange?.(type)
    setIsHovered(false)
  }

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
    const prev = reactionsState
    let next: ReactionData[]
    const existing = prev.find((r) => r.emoji === emoji && r.owner === 'yours')
    if (existing) {
      next = existing.count <= 1
        ? prev.filter((r) => r !== existing)
        : prev.map((r) => (r === existing
            ? { ...r, count: r.count - 1, owner: 'others' as const, names: r.names?.filter((n) => n !== 'You') }
            : r))
    } else {
      const othersExisting = prev.find((r) => r.emoji === emoji && r.owner === 'others')
      next = othersExisting
        ? prev.map((r) => (r === othersExisting
            ? { ...r, count: r.count + 1, owner: 'yours' as const, names: r.names && [...r.names, 'You'] }
            : r))
        : [...prev, { emoji, count: 1, owner: 'yours' as const, names: ['You'] }]
    }
    setReactionsState(next)
    onReactionsChange?.(next, emoji)
  }

  return (
    <>
      {/*
        The package's Card (UIG-27): lights up when pointed at, no hairline until
        then. `hovered` is this card's own state, not the pointer's: it holds
        while the ⋯ menu or the emoji picker is open, which open outside the
        card. Being edited is `active`; something new asks for attention in the
        hairline, and wins over the selected one's.
      */}
      <Card
        fill={subdued ? 'none' : 'surface'}
        // Read-only with nothing to open (an archived file's message with no replies): nothing on hover.
        hover={readOnly && !onClick ? 'none' : 'fill'}
        quietUntilHover
        hovered={isHovered}
        selected={isSelected}
        active={isEditing}
        attention={hasNewMessage || hasNewReply ? (isUrgent ? 'warning' : 'accent') : undefined}
        className={cn('relative', className)}
        // Only a card that opens something is clicked, and shows the pointer.
        onClick={
          onClick
            ? (e) => {
                if (isEditing) return
                // Don't open thread when any overlay is active
                if (moreMenuOpen || showResolveDialog || pickerOpen || confirmingDelete) return
                // Don't open thread when clicking interactive children
                const target = e.target as HTMLElement
                if (target.closest('button, [role="button"], [data-interactive]')) return
                onClick()
              }
            : undefined
        }
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          if (pickerOpen || moreMenuOpen) return
          setIsHovered(false)
        }}
      >

        {/* ── Message box ── */}
        {isEditing ? (
          /* Edit layout: avatar + the shared box's edit form side by side. */
          <div className="p-2">
            <div className="flex items-start gap-2">
              <Avatar size={24} src={authorAvatarSrc} alt={authorName} className="shrink-0 mt-1" />
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
                onCancel={() => setEditing(null)}
                className="flex-1 min-w-0"
              />
            </div>
          </div>
        ) : (
        /* Normal layout: header + body + reactions + replies */
        <div className="flex flex-col items-start pt-2 px-2">
          {deleted ? (
            <div className="pl-8 pr-2 pb-2 w-full">
              <MetaText>This comment was deleted.</MetaText>
            </div>
          ) : (
          <>
          {/* Header */}
          <div className={cn('flex items-center gap-2 w-full', hasNewMessage && 'justify-between')}>
            <div className="flex items-center gap-2 shrink-0">
              <Avatar size={24} src={authorAvatarSrc} alt={authorName} />
              <span className="text-body-2-strong text-text-primary whitespace-nowrap">{authorName}</span>
              <MetaText>{timestamp}</MetaText>
              <EditedMarker editedAt={editedAt} />
              {highlightState && <HighlightPill type={highlightState} />}
            </div>
            {hasNewMessage && !isUrgent && <UnreadDot />}
            {hasNewMessage && isUrgent && (
              <div className="w-6 h-6 flex items-center justify-center shrink-0">
                <div className="flex items-center p-0.5 rounded-full bg-warning-muted signal:shadow-glow-warning">
                  <IconAlertSquareRounded size={12} stroke={2.5} className="text-warning-default" />
                </div>
              </div>
            )}
          </div>

          <div className="pl-8 pr-2 pt-1 pb-2 w-full">
            <MessageBody
              body={bodyState}
              nostrReferences={nostrReferences}
              nostrBlockId={nostrBlockId}
              urgentMentions={urgentMentions}
              parts={parts}
              embeds={embeds}
              authorName={authorName}
              here={here}
              // The author's ✕, offered where Edit is: an edit with that card `none` and every other kept (§13.6.2).
              onRemoveCard={isOwnMessage && !readOnly && onEmbedsChange ? (value) => onEmbedsChange(withoutCard(embeds, value)) : undefined}
            />
          </div>
          </>
          )}

          {/* Uploaded files — image thumbnails / file chips.
              `items-start` because they are not the same height: a file row is
              48px and an image card is ~150, and stretching left a `.pdf` chip
              with its icon floating in a tall empty box (2026-08-19). */}
          {!isEditing && files && files.length > 0 && (
            <div className="flex flex-wrap items-start gap-2 pl-8 pr-2 pb-2 w-full">
              {files.map((f, i) => (
                <AttachmentCard key={`${f.sha256 ?? f.name}_${i}`} {...postedAttachment(f)} fetchImage={blobObjectUrl} download data-interactive />
              ))}
            </div>
          )}

          {/* Reactions */}
          {!isEditing && reactionsState.length > 0 && (
            <div className="flex items-center gap-2 pl-8 pt-1 pb-2 w-full">
              {reactionsState.map((r, i) => (
                <ReactionPill key={i} emoji={r.emoji} count={r.count} owner={r.owner} names={r.names} onClick={readOnly ? undefined : () => handleReact(r.emoji)} />
              ))}
            </div>
          )}

          {/* Replies */}
          {!isEditing && replyCount != null && replyCount > 0 && (
            <RepliesRow replyCount={replyCount} replyAuthors={replyAuthors} lastReplyTime={lastReplyTime} hasNewReply={hasNewReply} isUrgent={isUrgent} />
          )}
        </div>
        )}

        {/* ── Resolution banner - bottom, hidden while editing ──
            signal:ml-10 = card px-2 (8) + reply-row pl-8 (32): the banner's box
            edge lines up with the reply pill's hover background above it. */}
        {resolved && !isEditing && (
          <div className="flex items-center gap-2 pl-10 pr-3 pb-2 signal:ml-10 signal:mr-3 signal:mb-2 signal:pl-3 signal:pr-3 signal:py-2.5 signal:rounded-lg signal:border signal:border-success-outline signal:bg-success-wash">
            <IconChecks size={16} stroke={1.5} className="text-success-default shrink-0 signal:drop-shadow-glow-success" />
            <span className="text-h5 text-success-default whitespace-nowrap">
              {resolvedBy || 'Someone'} resolved
            </span>
            {resolutionMsg && (
              <>
                <IconArrowNarrowRight size={12} stroke={1.5} className="text-text-primary shrink-0" />
                <span className="text-h5 text-text-primary truncate">{resolutionMsg}</span>
              </>
            )}
          </div>
        )}

        {/* ── Quick menu on hover ── */}
        {isHovered && !isEditing && !readOnly && (
          <div className="absolute right-1 top-1" onClick={(e) => e.stopPropagation()}>
            <ConversationQuickMenu
              isResolved={resolved}
              onReact={handleReact}
              onPickerOpenChange={setPickerOpen}
              onReply={onReply}
              onResolve={() => setShowResolveDialog(true)}
              onReopen={handleReopen}
              more={
                <ConversationMoreMenu
                  trigger={
                    <ToolbarButton tooltip="More actions" aria-label="More actions">
                      <IconDotsVertical size={16} stroke={1.5} />
                    </ToolbarButton>
                  }
                  onOpenChange={(next) => {
                    setMoreMenuOpen(next)
                    if (next) onMore?.()
                  }}
                  isResolved={resolved}
                  currentHighlight={highlightState}
                  onHighlight={handleConvHighlight}
                  onResolve={() => setShowResolveDialog(true)}
                  onReopen={handleReopen}
                  isOwnMessage={isOwnMessage}
                  onEditMessage={isOwnMessage ? () => handleEditStart() : undefined}
                  onDelete={isOwnMessage ? handleDelete : undefined}
                />
              }
            />
          </div>
        )}

      </Card>

      {confirmingDelete && (
        <ConfirmDelete
          what="message"
          replies={replyCount ?? 0}
          onConfirm={() => onDelete?.()}
          onClose={() => setConfirmingDelete(false)}
        />
      )}

      {showResolveDialog && (
        <ResolveDialog
          onResolve={handleResolveConfirm}
          onCancel={() => setShowResolveDialog(false)}
        />
      )}

    </>
  )
}
