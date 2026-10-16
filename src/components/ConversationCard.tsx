import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import type { Embed } from '@estiva-app/protocol'
import { PEEK_EDITOR_CLASSES, peekEditExtensions } from '@/extensions/peekEditor'
import { SelectionToolbar, isSuggestionActive, isSuggestionOpen } from '@estiva-app/ui/editor'
import { extractResolution, extractResolutionFromText } from '@/extensions/resolution'
import { extractHighlightType } from '@/extensions/highlight'
import {
  IconAlertSquareRounded,
  IconChecks,
  IconArrowNarrowRight,
  IconDotsVertical,
} from '@tabler/icons-react'
import { Button } from './ui/Button'
import { AttachmentCard, Avatar, Card, Toolbar, ToolbarButton } from '@estiva-app/ui'
import { RepliesRow } from './ui/RepliesRow'
import { Reaction as ReactionPill } from './ui/Reaction'
import { ConversationQuickMenu } from './ConversationQuickMenu'
import { ConversationMoreMenu } from './ConversationMoreMenu'
import { ResolveDialog } from './ResolveDialog'
import { ConfirmDelete } from './ConfirmDelete'
import { PEOPLE } from '@/api'
import { type ReactionData, type HighlightType, type FileAttachment } from '@/api'
import { useCanUpload, isCurrentUser } from '@/api'
import { AttachFileButton, AttachmentChips } from './ui/AttachFiles'
import { HighlightButton } from './ui/HighlightButton'
import { CardButton } from './ui/CardButton'
import { cardsToEdit, loadCards } from '@/extensions/cardChoices'
import { HighlightPill } from './ui/HighlightPill'
import { EditedMarker } from './ui/EditedMarker'
import { MessageBody } from './ui/MessageBody'
import { UnreadDot } from './ui/UnreadDot'
import { cn } from '@/lib/utils'
import { useEditAttachments } from '@/lib/useEditAttachments'
import { takeRefusedEdit, useRefusedEdit } from '@/lib/refusedEdits'
import { pastedImages, postedAttachment } from '@/lib/fileAttachments'
import { blobObjectUrl } from '@/nostr/media'

import { textToTiptapContent, serializeTiptapToText, withUrgentMentions, withoutNewUrgency } from '@/lib/textParsing'
import { MetaText } from '@/components/ui/MetaText'
import { WRITING_BOX_CLASSES } from '@/components/ui/looks'

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

  // Edit mode
  const [isEditing, setIsEditing] = useState(false)
  const [editEmpty, setEditEmpty] = useState(false)
  const [editHasUrgent, setEditHasUrgent] = useState(false)
  const [editHasHighlight, setEditHasHighlight] = useState(false)

  // The files of the message being edited — PEE-16. Held here because the
  // paperclip, the paste and Save all need the same list.
  const editAttachments = useEditAttachments(files)
  const canUpload = useCanUpload()
  // The paste handler is a closure from the editor's first render, so it
  // reads the current one through a ref. Assigned in an effect rather than
  // during render: a paste can only happen after the box is on screen.
  const editAttachmentsRef = useRef(editAttachments)
  useEffect(() => {
    editAttachmentsRef.current = editAttachments
  })

  const editSaveFnRef = useRef<() => void>(() => {})
  const editCancelFnRef = useRef<() => void>(() => {})
  const editEmptyRef = useRef(true)
  const editEditorRef = useRef<Editor | null>(null)
  /** The text a refused edit saved, for the edit box to open with instead of the body (OPT-8). */
  const restoredEdit = useRef<string | undefined>(undefined)
  /** The edit box itself — what the highlight picker hangs from. */
  const editBoxRef = useRef<HTMLDivElement>(null)

  /*
    The edit box's editor, while the message is being edited, and null
    otherwise (OPT-6). Made by `EditorHost` when editing starts rather than with
    every card: a long topic built one per message, and after the page sat
    idle the first new card paid ~140 ms rebuilding one nobody would use —
    most of a sent message's 100 ms.
  */
  const [editEditor, setEditEditor] = useState<Editor | null>(null)
  const editOptions: EditorHostOptions = {
    extensions: peekEditExtensions,
    editorProps: {
      attributes: {
        class: PEEK_EDITOR_CLASSES,
        style: 'caret-color: var(--text-primary)',
      },
      /* A screenshot pasted while editing becomes an attachment, exactly as it
         does in the composer — PEE-16. `pastedImages` is what decides an image
         from a copy that merely carries one (text wins), so a pasted table
         stays a table. Returning true keeps the picture out of the document:
         it belongs in a chip. See ComposeBox for the longer note. */
      handlePaste: (_view, event) => {
        if (!canUpload) return false
        const images = pastedImages(event.clipboardData)
        if (images.length === 0) return false
        editAttachmentsRef.current.add(images)
        return true
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          if (isSuggestionActive()) return false
          if (!editEmptyRef.current) editSaveFnRef.current()
          return true
        }
        // Shift+Enter: in list → split item (or exit if empty), else new paragraph
        if (event.key === 'Enter' && event.shiftKey) {
          const ed = editEditorRef.current
          if (!ed) return false
          const { $from } = view.state.selection
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              const listItem = $from.node(d)
              if (listItem.textContent.length === 0) {
                ed.commands.liftListItem('listItem')
              } else {
                ed.commands.splitListItem('listItem')
              }
              return true
            }
          }
          // Empty quote line exits the quote (mirrors empty-list-item lift).
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'blockquote') {
              if ($from.parent.textContent.length === 0) {
                ed.commands.lift('paragraph')
                return true
              }
              break
            }
          }
          ed.commands.splitBlock()
          return true
        }
        /* An open `@`, `[` or `/` menu owns Escape: the first press closes
           the menu, a second cancels the edit. Without this the plugin never
           saw the key — ProseMirror asks `editorProps` before any plugin — so
           reaching for the menu's Escape threw the whole edit away. */
        if (event.key === 'Escape') {
          if (isSuggestionOpen()) return false
          editCancelFnRef.current()
          return true
        }
        return false
      },
    },
    content: '',
    autofocus: false,
    onUpdate({ editor }) {
      const doc = editor.state.doc
      let hasNonParagraph = false
      let hasAtomNode = false
      doc.forEach((node) => {
        if (node.type.name !== 'paragraph') hasNonParagraph = true
      })
      doc.descendants((node) => {
        if (node.isAtom && node.type.name !== 'paragraph') hasAtomNode = true
      })
      const empty = doc.textContent.length === 0 && !hasNonParagraph && !hasAtomNode
      setEditEmpty(empty)
      editEmptyRef.current = empty
      if (empty && doc.childCount > 1) {
        requestAnimationFrame(() => {
          editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
        })
      }
      let urgent = false
      let highlight = false
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'urgentMention') urgent = true
        if (node.type.name === 'highlightTag') highlight = true
      })
      setEditHasUrgent(urgent)
      setEditHasHighlight(highlight)
    },
  }

  editEditorRef.current = editEditor

  // When entering edit mode, populate with current body text. Leaving it unmounts the editor.
  useEffect(() => {
    if (!editEditor) return
    if (isEditing) {
      // The text says only `nostr:npub…`; the urgent chips come back from the tags (CON-24).
      const content = withUrgentMentions(textToTiptapContent(restoredEdit.current ?? bodyState), urgentMentions)
      restoredEdit.current = undefined
      // If message has a highlight, prepend the tag to the first paragraph
      if (highlightState && content.content && content.content.length > 0) {
        const first = content.content[0]
        if (first.type === 'paragraph') {
          const existing = (first.content ?? []) as Record<string, unknown>[]
          first.content = [
            { type: 'highlightTag', attrs: { highlightType: highlightState } },
            { type: 'text', text: ' ' },
            ...existing,
          ]
        }
      }
      // If the message is currently resolved, append a resolutionBlock so the
      // resolution text is visible and editable inline. Removing the block on
      // save reopens the conversation; clearing the text leaves it resolved
      // with no message (matches the empty-sentinel send path).
      if (resolved) {
        const resolutionText = resolutionMsg ? `→ ${resolutionMsg}` : '→ '
        content.content.push({
          type: 'resolutionBlock',
          content: [{ type: 'text', text: resolutionText }],
        })
      }
      editEditor.commands.setContent(content)
      // The text says only which references there are; their cards come back from the folded tags (OPT-17).
      loadCards(editEditor, embeds)
      // Focus and move cursor to end
      setTimeout(() => {
        editEditor.commands.focus('end')
      }, 0)
    }
  }, [isEditing, editEditor]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleEditStart = () => {
    editAttachments.begin()
    setIsEditing(true)
  }

  /*
    An edit the relay refused (OPT-8): the message shows its old text again,
    and its edit box reopens holding what was saved (Miky, 9 Oct) — now, or
    when this card is next drawn if the person had moved on. A box already
    open again is left as the person has it.
  */
  const refusedEdit = useRefusedEdit(messageId)
  useEffect(() => {
    if (refusedEdit === undefined || !messageId || !takeRefusedEdit(messageId)) return
    setBodyState(body)
    if (isEditing) return
    restoredEdit.current = refusedEdit
    handleEditStart()
  }, [refusedEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleEditSave = () => {
    if (!editEditor) return
    const wasResolved = resolved
    const trimmed = withoutNewUrgency(serializeTiptapToText(editEditor), bodyState)
    let resolution = extractResolution(editEditor)
    let finalBody = trimmed

    // Fallback: if the InputRule didn't fire (e.g. pasted "-> X" at a line
    // start), parse the serialized text. Start-of-line arrows only — mid-line
    // arrows are prose (ruling 2026-07-23).
    if (!resolution.hasResolution) {
      const fromText = extractResolutionFromText(trimmed)
      if (fromText) {
        finalBody = fromText.body
        resolution = { hasResolution: true, resolutionMessage: fromText.resolutionMessage }
      }
    }

    if (finalBody) {
      setBodyState(finalBody)
      onBodyChange?.(finalBody)
    }
    if (resolution.hasResolution) {
      // Editor still has a resolution block → message stays / becomes resolved
      // with the (possibly edited) message text.
      setResolved(true)
      setResolvedBy('You')
      setResolutionMsg(resolution.resolutionMessage)
      onResolvedChange?.(true, 'You', resolution.resolutionMessage)
    } else if (wasResolved) {
      // Was resolved before edit, no resolution block in editor anymore →
      // the user deleted it intentionally to reopen the conversation.
      setResolved(false)
      setResolvedBy('')
      setResolutionMsg('')
      onResolvedChange?.(false, undefined, undefined)
    }
    // Preserve highlight type from edit
    const hl = extractHighlightType(editEditor)
    setHighlightState(hl)
    onHighlightChange?.(hl)
    // Files last, and only when this edit changed them — PEE-16. `commit`
    // leaves storage alone: the message owns these blobs now.
    const nextFiles = editAttachments.result()
    if (nextFiles) onFilesChange?.(nextFiles)
    editAttachments.commit()
    // The cards only when this edit changed them, in the same edit (OPT-17).
    const nextCards = cardsToEdit(editEditor, embeds)
    if (nextCards) onEmbedsChange?.(nextCards)
    setIsEditing(false)
  }

  /* Cancel undoes the whole edit, files included: the removed come back and
     anything attached during it is deleted from storage, because nothing will
     ever own it. */
  const handleEditCancel = () => {
    editAttachments.cancel()
    setIsEditing(false)
  }

  editSaveFnRef.current = handleEditSave
  editCancelFnRef.current = handleEditCancel

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
          /* Edit layout: avatar + textarea box side by side */
          <div className="p-2 border border-accent-primary rounded-lg">
            <div className="flex items-start gap-2">
              <Avatar size={24} src={authorAvatarSrc} alt={authorName} className="shrink-0 mt-1" />
              {/* `relative` so the highlight picker hangs off this box, the
                  way it hangs off the composer's — the edit box is a compose
                  box, and everything the composer can do belongs here. */}
              <div ref={editBoxRef} className={cn(WRITING_BOX_CLASSES, 'flex-1 min-w-0')}>
                <div className={cn(
                  'relative min-h-[20px] transition-all',
                  (editHasUrgent || editHasHighlight) && 'border-l-4 border-border-strong pl-2'
                )}>
                  <EditorHost options={editOptions} onEditor={setEditEditor} />
                  <EditorContent editor={editEditor} />
                  {/* Bold / italic / underline / link over a selection. */}
                  <SelectionToolbar editor={editEditor} link />
                  {editEmpty && (
                    <div className="absolute inset-0 pointer-events-none flex items-center text-body-2 text-text-muted">
                      Edit message
                    </div>
                  )}
                </div>
                {/* The message's files and the ones just attached, one row,
                    each removable — PEE-16. */}
                <AttachmentChips chips={editAttachments.chips} />
                <div className="flex items-center justify-between">
                  {/* The composer's strip, and for the same reason (§4.2, D29).
                      Cancel and Save are answers, not tools, so they stay two
                      stops of their own on the right. */}
                  <Toolbar aria-label="Edit tools" surface={false} className="flex items-center gap-1">
                    <AttachFileButton onPick={editAttachments.add} />
                    <HighlightButton editor={editEditor} container={editBoxRef} />
                    <CardButton editor={editEditor} />
                  </Toolbar>
                  <div className="flex items-center gap-2">
                    <Button variant="outlined" size="small" className="w-14" onClick={handleEditCancel}>
                      Cancel
                    </Button>
                    {/* A message with a file and no text is a message, so an
                        empty editor alone no longer blocks Save. Uploads in
                        flight do, so a file is never dropped by a fast Save. */}
                    <Button
                      variant="primary"
                      size="small"
                      className="w-14"
                      disabled={(editEmpty && editAttachments.count === 0) || editAttachments.isUploading}
                      onClick={handleEditSave}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
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
            <MessageBody body={bodyState} nostrReferences={nostrReferences} nostrBlockId={nostrBlockId} urgentMentions={urgentMentions} parts={parts} embeds={embeds} authorName={authorName} here={here} />
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
                  onEditMessage={isOwnMessage ? handleEditStart : undefined}
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

type EditorHostOptions = Parameters<typeof useEditor>[0]

/**
 * Holds the edit box's editor while it is on screen, and hands it to the card
 * — before the paint, so the box never draws without it. Unmounting it
 * destroys the editor.
 */
function EditorHost({ options, onEditor }: { options: EditorHostOptions; onEditor: (editor: Editor | null) => void }) {
  const editor = useEditor(options)
  useLayoutEffect(() => {
    onEditor(editor)
    return () => onEditor(null)
  }, [editor, onEditor])
  return null
}
