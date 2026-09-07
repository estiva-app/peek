import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import { peekStarterKit } from '@/extensions/editorKit'
import { PeekMention, UrgentMention, TopicMention, FileMention, isSuggestionActive } from '@/extensions/mention'
import { ResolutionBlock, extractResolution, extractResolutionFromText } from '@/extensions/resolution'
import { HighlightTag, extractHighlightType } from '@/extensions/highlight'
import {
  IconMessage2,
  IconChevronRight,
  IconAlertSquareRounded,
  IconChecks,
  IconArrowNarrowRight,
  IconCircleDashed,
  IconCircleCheck,
  IconPaperclip,
  IconSquareForbid2,
} from '@tabler/icons-react'
import figmaIcon from '@/assets/figma icon.svg'
import { FrameArt } from './ui/FrameArt'
import { FrameLightbox } from './FrameLightbox'
import { frameById, frameBreadcrumb, type FigmaFrame } from '@/api'
import { IconButton } from './ui/IconButton'
import { Button } from './ui/Button'
import { Avatar } from './ui/Avatar'
import { AvatarGroup } from '@estiva-app/ui'
import { Chip } from './ui/Chip'
import { Reaction as ReactionPill } from './ui/Reaction'
import { TopicState } from './ui/TopicState'
import { ConversationQuickMenu } from './ConversationQuickMenu'
import { ConversationMoreMenu } from './ConversationMoreMenu'
import ReactionPicker from './ReactionPicker'
import { ResolveDialog } from './ResolveDialog'
import { CreateTopicDialog, type StartTopicResult } from './CreateTopicDialog'
import { PEOPLE, type Person } from '@/api'
import { type ReactionData, type HighlightType, type FileAttachment } from '@/api'
import { useIsTopicResolved, useAvatarSrc } from '@/api'
import { FileAttachmentCard } from './ui/FileAttachmentCard'
import { HighlightPill } from './ui/HighlightPill'
import { MessageBody } from './ui/MessageBody'
import { cn } from '@/lib/utils'
import { useTopicPath } from '@/lib/useTopicPath'

import { textToTiptapContent, serializeTiptapToText } from '@/lib/textParsing'

interface ConversationCardProps {
  authorName: string
  authorAvatarSrc?: string
  timestamp: string
  body: string
  reactions?: ReactionData[]
  replyCount?: number
  /** Reply-author names for the signal theme's facepile reply row (ignored elsewhere). */
  replyAuthors?: { name: string; avatarSrc?: string }[]
  /** Time of the last reply, shown in the signal theme's reply row (ignored elsewhere). */
  lastReplyTime?: string
  /** Figma frame ids attached to the message (rendered as preview cards). */
  attachments?: string[]
  /** Real uploaded files (rendered as file chips / image thumbnails). */
  files?: FileAttachment[]
  hasNewReply?: boolean
  hasNewMessage?: boolean
  isUrgent?: boolean
  isResolved?: boolean
  resolvedBy?: string
  resolutionMessage?: string
  isTopic?: boolean
  topicTitle?: string
  highlightType?: HighlightType
  nostrReferences?: string[]
  /** Which block of the referenced object this is about — SPEC §13.6. */
  nostrBlockId?: string
  onHighlightChange?: (type: HighlightType | undefined) => void
  onBodyChange?: (body: string) => void
  showCreateTopic?: boolean
  /** When set, the Start-topic dialog renders the DM-to-huddle privacy banner and pre-fills invite chips with these participants. */
  dmContext?: { participants: Person[] }
  /** When set, the topic-anchor block renders as a huddle anchor (lock icon + "Huddle in [Topic]" link) above the message.
   *  `topicResolved` flips the dashed-circle icon to the green checkmark when every conv in that topic is resolved. */
  huddleContext?: { topicId: string; topicTitle: string; topicResolved?: boolean }
  /** Called when user confirms Start topic from a DM context. When provided, supersedes the in-place isTopic flip. */
  onStartTopicFromDm?: (data: StartTopicResult) => void
  onResolvedChange?: (resolved: boolean, resolvedBy?: string, message?: string) => void
  onReactionsChange?: (reactions: ReactionData[], emoji: string) => void
  onDelete?: () => void
  isSelected?: boolean
  onReply?: () => void
  onClick?: () => void
  onMore?: () => void
  className?: string
}

export function ConversationCard({
  authorName,
  authorAvatarSrc,
  timestamp,
  body,
  reactions,
  replyCount,
  replyAuthors,
  lastReplyTime,
  attachments,
  files,
  hasNewReply = false,
  hasNewMessage = false,
  isUrgent = false,
  isResolved: initialResolved = false,
  resolvedBy: initialResolvedBy = '',
  resolutionMessage: initialResolutionMessage = '',
  isTopic: initialIsTopic = false,
  nostrReferences,
  nostrBlockId,
  topicTitle: initialTopicTitle = '',
  highlightType,
  onHighlightChange,
  onBodyChange,
  showCreateTopic = true,
  dmContext,
  huddleContext,
  onStartTopicFromDm,
  onResolvedChange,
  onReactionsChange,
  onDelete,
  isSelected = false,
  onReply,
  onClick,
  onMore,
  className,
}: ConversationCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const pathForTopic = useTopicPath()
  // The ⋯ menu: the quick-menu's measured rect, or closed. The shared Menu
  // shell owns placement and every exit (2026-09-03).
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<DOMRect | null>(null)

  // Reactions. The picker portals above the quick bar (ThreadReplyCard's
  // pattern) — in-flow it was clipped by the panel's scroll container on the
  // topmost card.
  const [reactionsState, setReactionsState] = useState<ReactionData[]>(reactions ?? [])
  const [reactionPickerPos, setReactionPickerPos] = useState<{ top: number; right: number } | null>(null)
  const reactButtonRef = useRef<HTMLDivElement>(null)
  const reactionPickerRef = useRef<HTMLDivElement>(null)

  // Sync local reaction state if the parent passes a different override (e.g. after navigation back).
  useEffect(() => {
    setReactionsState(reactions ?? [])
  }, [reactions])

  // Highlight
  const [highlightState, setHighlightState] = useState<HighlightType | undefined>(highlightType)

  // Body - mutable after edit
  const [bodyState, setBodyState] = useState(body)

  // Edit mode
  const [isEditing, setIsEditing] = useState(false)
  const [previewFrame, setPreviewFrame] = useState<FigmaFrame | null>(null)
  const [editEmpty, setEditEmpty] = useState(false)
  const [editHasUrgent, setEditHasUrgent] = useState(false)
  const [editHasHighlight, setEditHasHighlight] = useState(false)

  const editSaveFnRef = useRef<() => void>(() => {})
  const editCancelFnRef = useRef<() => void>(() => {})
  const editEmptyRef = useRef(true)
  const editEditorRef = useRef<ReturnType<typeof useEditor>>(null)

  const editEditor = useEditor({
    extensions: [
      peekStarterKit,
      PeekMention,
      UrgentMention,
      TopicMention,
      FileMention,
      ResolutionBlock,
      HighlightTag,
    ],
    editorProps: {
      attributes: {
        class: 'outline-none w-full bg-transparent text-sm text-text-primary leading-[1.4] break-words min-h-[20px]',
        style: 'caret-color: var(--text-primary)',
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
        if (event.key === 'Escape') {
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
  })

  editEditorRef.current = editEditor

  // When entering edit mode, populate with current body text
  useEffect(() => {
    if (!editEditor) return
    if (isEditing) {
      const content = textToTiptapContent(bodyState)
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
      // Focus and move cursor to end
      setTimeout(() => {
        editEditor.commands.focus('end')
      }, 0)
    } else {
      editEditor.commands.clearContent()
    }
  }, [isEditing, editEditor]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close the reaction picker on click outside (the more menu's exits are the
  // shared shell's own).
  useEffect(() => {
    if (!reactionPickerPos) return
    const close = (e: MouseEvent) => {
      if (reactionPickerRef.current?.contains(e.target as Node)) return
      if (reactButtonRef.current?.contains(e.target as Node)) return
      setReactionPickerPos(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [reactionPickerPos])

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

  // Topic state
  const [isTopic, setIsTopic] = useState(initialIsTopic)
  const [topicTitle, setTopicTitle] = useState(initialTopicTitle)
  const [showTopicDialog, setShowTopicDialog] = useState(false)

  // Resolved-state of any *referenced* topic (for inline [Topic] mentions and the
  // topic-anchor icon). Reads runtime mutations so the icon reflects user changes.
  const isTopicResolved = useIsTopicResolved()
  /** Reply authors' faces, resolved as Peek's Avatar wrapper resolves any other. */
  const avatarSrcFor = useAvatarSrc()

  const handleMore = (rect: DOMRect) => {
    // Toggle; the shared shell decides above/below from the real room.
    if (moreMenuAnchor) {
      setMoreMenuAnchor(null)
      return
    }
    setMoreMenuAnchor(rect)
    onMore?.()
  }

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
    setMoreMenuAnchor(null)
    onResolvedChange?.(false)
  }

  const handleDelete = () => {
    setMoreMenuAnchor(null)
    onDelete?.()
  }

  const handleConvHighlight = (type: HighlightType | undefined) => {
    setHighlightState(type)
    onHighlightChange?.(type)
    setMoreMenuAnchor(null)
    setIsHovered(false)
  }

  const handleEditStart = () => {
    setIsEditing(true)
    setMoreMenuAnchor(null)
  }

  const handleEditSave = () => {
    if (!editEditor) return
    const wasResolved = resolved
    const trimmed = serializeTiptapToText(editEditor)
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
    setIsEditing(false)
  }

  const handleEditCancel = () => setIsEditing(false)

  editSaveFnRef.current = handleEditSave
  editCancelFnRef.current = handleEditCancel

  const openCreateTopic = () => {
    setMoreMenuAnchor(null)
    setShowTopicDialog(true)
  }

  const handleTopicConfirm = (data: StartTopicResult) => {
    setShowTopicDialog(false)
    if (dmContext && onStartTopicFromDm) {
      onStartTopicFromDm(data)
      return
    }
    setIsTopic(true)
    setTopicTitle(data.title)
  }

  const handleRevertToConversation = () => {
    setIsTopic(false)
    setTopicTitle('')
    setMoreMenuAnchor(null)
  }

  const handleReact = (emoji: string) => {
    setReactionsState((prev) => {
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
      onReactionsChange?.(next, emoji)
      return next
    })
    setReactionPickerPos(null)
  }

  return (
    <>
      <div
        className={cn(
          'relative rounded-lg transition-colors border',
          isEditing
            ? 'bg-bg-selected border-accent-primary'
            : cn(
                isSelected
                  ? 'bg-bg-selected'
                  : isHovered
                    ? 'bg-bg-hover'
                    : 'bg-bg-surface',
                // Notification borders override the default state border
                (hasNewMessage || hasNewReply)
                  ? isUrgent
                    ? 'border-warning-muted'
                    : 'border-accent-muted'
                  : isSelected
                    ? 'border-border-subtle'
                    : isHovered
                      ? 'border-border-default'
                      : 'border-transparent'
              ),
          onClick && !isEditing && 'cursor-pointer',
          className
        )}
        onClick={(e) => {
          if (!onClick || isEditing) return
          // Don't open thread when any overlay is active
          if (moreMenuAnchor || showResolveDialog || showTopicDialog || reactionPickerPos) return
          // Don't open thread when clicking interactive children
          const target = e.target as HTMLElement
          if (target.closest('button, [role="button"], [data-interactive]')) return
          onClick()
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => { setIsHovered(false); setReactionPickerPos(null) }}
      >

        {/* ── Topic anchor header (existing isTopic) - hidden while editing ── */}
        {isTopic && !huddleContext && !isEditing && (
          <div className="flex items-start gap-2 px-2 py-3 pb-2">
            <div className="flex flex-col items-center gap-1 w-6 shrink-0">
              <TopicState
                type="topic"
                status={resolved ? 'resolved' : 'unresolved'}
              />
              <div className="w-px bg-border-default flex-1 min-h-[24px]" />
            </div>
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="h-4 flex items-center gap-1.5">
                <span className="text-h5 text-text-secondary shrink-0">Huddle in</span>
                <span className="text-h5 text-text-primary truncate">{topicTitle}</span>
              </div>
              {resolved && (
                <div className="flex items-center gap-2 mt-1 py-1">
                  <IconChecks size={16} stroke={1.5} className="text-success-default shrink-0" />
                  <span className="text-menu text-success-default whitespace-nowrap">
                    {resolvedBy || 'Someone'} resolved
                  </span>
                  {resolutionMsg && (
                    <>
                      <IconArrowNarrowRight size={12} stroke={1.5} className="text-text-primary shrink-0" />
                      <span className="text-menu text-text-primary truncate">{resolutionMsg}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Huddle anchor header - hidden while editing ── */}
        {huddleContext && !isEditing && (
          <div className="flex items-start gap-1 px-2 py-3 pb-1">
            <div className="flex flex-col items-center gap-1 w-6 shrink-0">
              {huddleContext.topicResolved ? (
                <IconCircleCheck size={16} stroke={1.5} className="text-success-default" />
              ) : (
                <IconCircleDashed size={16} stroke={1.5} className="text-text-secondary" />
              )}
              <div className="w-px bg-border-default flex-1 min-h-[16px]" />
            </div>
            <div className="flex-1 min-w-0 flex items-center gap-1.5 h-4">
              <span className="text-h5 text-text-secondary shrink-0">Huddle in</span>
              <Link
                to={pathForTopic(huddleContext.topicId)}
                data-interactive
                onClick={(e) => e.stopPropagation()}
                className="text-h5 text-text-primary hover:underline truncate"
              >
                {huddleContext.topicTitle}
              </Link>
            </div>
          </div>
        )}

        {/* ── Message box ── */}
        {isEditing ? (
          /* Edit layout: avatar + textarea box side by side */
          <div className="p-2 border border-accent-primary rounded-lg">
            <div className="flex items-start gap-2">
              <Avatar size={24} src={authorAvatarSrc} alt={authorName} className="shrink-0 mt-1" />
              <div className="flex-1 min-w-0 bg-bg-inset border border-border-default rounded-lg p-3 flex flex-col gap-4 signal:transition-shadow signal:focus-within:border-border-focus signal:focus-within:shadow-[shadow:var(--focus-ring)]">
                <div className={cn(
                  'relative min-h-[20px] transition-all',
                  (editHasUrgent || editHasHighlight) && 'border-l-[4px] border-border-strong pl-2'
                )}>
                  <EditorContent editor={editEditor} />
                  {editEmpty && (
                    <div className="absolute inset-0 pointer-events-none flex items-center text-sm text-text-muted leading-[1.4]">
                      Edit message
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <IconButton tooltip="Attach file" aria-label="Attach file">
                      <IconPaperclip size={16} stroke={1.5} />
                    </IconButton>
                    <IconButton tooltip="Snooze" aria-label="Snooze">
                      <IconSquareForbid2 size={16} stroke={1.5} />
                    </IconButton>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outlined" size="small" className="w-14" onClick={handleEditCancel}>
                      Cancel
                    </Button>
                    <Button variant="primary" size="small" className="w-14" disabled={editEmpty} onClick={handleEditSave}>
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
        /* Normal layout: header + body + reactions + replies */
        <div className={cn('flex flex-col items-start pt-2 px-2', isTopic && 'pt-0')}>
          {/* Header */}
          <div className={cn('flex items-center gap-2 w-full', hasNewMessage && 'justify-between')}>
            <div className="flex items-center gap-2 shrink-0">
              <Avatar size={24} src={authorAvatarSrc} alt={authorName} />
              <span className="text-body-2-strong text-text-primary whitespace-nowrap">{authorName}</span>
              <span className="text-caption text-text-muted whitespace-nowrap signal:font-mono signal:text-[10px] signal:tracking-[0.02em] signal:tabular-nums">{timestamp}</span>
              {highlightState && <HighlightPill type={highlightState} />}
            </div>
            {hasNewMessage && !isUrgent && (
              <div className="w-6 h-6 flex items-center justify-center shrink-0">
                <div className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
              </div>
            )}
            {hasNewMessage && isUrgent && (
              <div className="w-6 h-6 flex items-center justify-center shrink-0">
                <div className="flex items-center p-0.5 rounded-full bg-warning-muted signal:shadow-[shadow:0_0_5px_rgba(255,176,32,0.4)]">
                  <IconAlertSquareRounded size={12} stroke={2.5} className="text-warning-default" />
                </div>
              </div>
            )}
          </div>

          <div className="pl-8 pr-2 pt-1 pb-2 w-full">
            <MessageBody body={bodyState} isTopicResolved={isTopicResolved} nostrReferences={nostrReferences} nostrBlockId={nostrBlockId} />
          </div>

          {/* Figma frame attachments - preview cards, click to view full screen */}
          {!isEditing && attachments && attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pl-8 pr-2 pb-2 w-full">
              {attachments.map((id) => {
                const frame = frameById(id)
                if (!frame) return null
                return (
                  <div
                    key={id}
                    data-interactive
                    className="flex flex-col w-[148px] rounded-lg border border-border-subtle bg-bg-inset hover:border-border-default p-1.5 gap-1.5 cursor-pointer transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPreviewFrame(frame)
                    }}
                  >
                    <div className="h-24 rounded-md bg-bg-active flex items-center justify-center overflow-hidden">
                      <FrameArt frame={frame} className={frame.kind === 'mobile' ? 'h-20' : 'w-[90%]'} />
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <img src={figmaIcon} width={14} height={14} alt="Figma" className="rounded-[3px] shrink-0" />
                      <div className="flex flex-col gap-[1px] min-w-0">
                        <span className="text-[12px] font-medium leading-[1.3] text-text-primary truncate">{frame.name}</span>
                        <span className="text-[10px] leading-[1.2] text-text-secondary truncate">{frameBreadcrumb(frame)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Uploaded files — image thumbnails / file chips.
              `items-start` because they are not the same height: a file row is
              48px and an image card is ~150, and stretching left a `.pdf` chip
              with its icon floating in a tall empty box (2026-08-19). */}
          {!isEditing && files && files.length > 0 && (
            <div className="flex flex-wrap items-start gap-2 pl-8 pr-2 pb-2 w-full">
              {files.map((f, i) => (
                <FileAttachmentCard key={f.storageId ?? `${f.name}_${i}`} file={f} />
              ))}
            </div>
          )}

          {/* Reactions */}
          {!isEditing && reactionsState.length > 0 && (
            <div className="flex items-center gap-2 pl-8 pt-1 pb-2 w-full">
              {reactionsState.map((r, i) => (
                <ReactionPill key={i} emoji={r.emoji} count={r.count} owner={r.owner} names={r.names} onClick={() => handleReact(r.emoji)} />
              ))}
            </div>
          )}

          {/* Replies */}
          {!isEditing && replyCount != null && replyCount > 0 && (
            <div className="flex items-center gap-2 pl-8 pr-2 pb-1.5 w-full">
              <div className="group/replies flex items-center gap-2 py-1.5 shrink-0 signal:px-2 signal:rounded-lg signal:border signal:border-transparent signal:hover:border-accent-outline signal:hover:bg-accent-wash signal:transition-colors">
                {replyAuthors && replyAuthors.length > 0 && (
                  /* The shared stack at 18px (2026-09-03). This row hand-rolled
                     its own for want of a size prop, and drifted while it did:
                     four faces where the shared rule is three, and its own ring.
                     The picture chain is Peek's Avatar wrapper's, kept exactly —
                     the message's own face, else the registry's for that name. */
                  <div className="hidden signal:flex items-center shrink-0">
                    <AvatarGroup
                      size={18}
                      members={replyAuthors.map((a) => ({ name: a.name, picture: a.avatarSrc ?? avatarSrcFor(a.name) }))}
                    />
                  </div>
                )}
                <IconMessage2
                  size={16}
                  stroke={1.5}
                  className={cn(
                    'text-text-secondary group-hover/replies:text-text-primary transition-colors shrink-0 signal:text-[color:var(--text-interactive)] signal:group-hover/replies:text-text-primary',
                    replyAuthors && replyAuthors.length > 0 && 'signal:hidden'
                  )}
                />
                <span className="text-chip text-text-secondary group-hover/replies:text-text-primary transition-colors signal:font-medium signal:text-[color:var(--text-interactive)] signal:group-hover/replies:text-text-primary">
                  {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                </span>
                {lastReplyTime && (
                  <span className="hidden signal:inline font-mono text-[9.5px] leading-[12px] mt-px text-text-muted tabular-nums">
                    {lastReplyTime}
                  </span>
                )}
                <IconChevronRight
                  size={12}
                  stroke={2}
                  className="hidden signal:block text-text-muted group-hover/replies:text-text-primary transition-all group-hover/replies:translate-x-0.5"
                />
              </div>
              {hasNewReply && !isUrgent && (
                <>
                  <div className="w-0.5 h-0.5 rounded-full bg-text-muted shrink-0" />
                  <Chip type="brand" label="1 new" />
                </>
              )}
              {hasNewReply && isUrgent && (
                <>
                  <div className="w-0.5 h-0.5 rounded-full bg-text-muted shrink-0" />
                  <Chip type="warning" label="1 new" />
                </>
              )}
            </div>
          )}
        </div>
        )}

        {/* ── Resolution banner - bottom, hidden while editing ──
            signal:ml-10 = card px-2 (8) + reply-row pl-8 (32): the banner's box
            edge lines up with the reply pill's hover background above it. */}
        {!isTopic && resolved && !isEditing && (
          <div className="flex items-center gap-2 pl-10 pr-3 pb-2 signal:ml-10 signal:mr-3 signal:mb-2 signal:pl-3 signal:pr-3 signal:py-2.5 signal:rounded-[10px] signal:border signal:border-success-outline signal:bg-success-wash">
            <IconChecks size={16} stroke={1.5} className="text-success-default shrink-0 signal:drop-shadow-[0_0_5px_rgba(63,222,140,0.6)]" />
            <span className="text-[12px] leading-[1.1] font-medium text-success-default whitespace-nowrap">
              {resolvedBy || 'Someone'} resolved
            </span>
            {resolutionMsg && (
              <>
                <IconArrowNarrowRight size={12} stroke={1.5} className="text-text-primary shrink-0" />
                <span className="text-[12px] leading-[1.1] font-medium text-text-primary truncate">{resolutionMsg}</span>
              </>
            )}
          </div>
        )}

        {/* ── Quick menu on hover ── */}
        {isHovered && !isEditing && (
          <div ref={reactButtonRef} className="absolute right-1 top-1" onClick={(e) => e.stopPropagation()}>
            <ConversationQuickMenu
              isResolved={resolved}
              onReact={() => {
                const rect = reactButtonRef.current?.getBoundingClientRect()
                setReactionPickerPos((prev) => (prev || !rect ? null : { top: rect.top - 4, right: window.innerWidth - rect.right }))
              }}
              onReply={onReply}
              onResolve={() => setShowResolveDialog(true)}
              onReopen={handleReopen}
              onMore={handleMore}
            />
          </div>
        )}

        {/* ── Reaction picker (portalled — in-flow it was clipped by the panel's
            scroll container on the topmost card) ── */}
        {reactionPickerPos &&
          createPortal(
            <div
              ref={reactionPickerRef}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseLeave={() => setReactionPickerPos(null)}
              style={{
                position: 'fixed',
                top: reactionPickerPos.top,
                right: reactionPickerPos.right,
                transform: 'translateY(-100%)',
                zIndex: 50,
              }}
            >
              <ReactionPicker onSelect={handleReact} />
            </div>,
            document.body
          )}

        {/* ── More menu — the shared shell portals, fits, and owns the exits ── */}
        {moreMenuAnchor && (
          <ConversationMoreMenu
            anchor={moreMenuAnchor}
            onClose={() => setMoreMenuAnchor(null)}
            isTopic={isTopic}
            isResolved={resolved}
            showCreateTopic={showCreateTopic}
            isOwnMessage={authorName === 'You'}
            currentHighlight={highlightState}
            onHighlight={handleConvHighlight}
            onCreateTopic={openCreateTopic}
            onRevertToConversation={handleRevertToConversation}
            onResolve={() => { setMoreMenuAnchor(null); setShowResolveDialog(true) }}
            onReopen={handleReopen}
            onEditMessage={!isTopic ? handleEditStart : undefined}
            onDelete={handleDelete}
          />
        )}
      </div>

      {showResolveDialog && (
        <ResolveDialog
          onResolve={handleResolveConfirm}
          onCancel={() => setShowResolveDialog(false)}
        />
      )}

      {showTopicDialog && (
        <CreateTopicDialog
          defaultTitle={isTopic ? topicTitle : ''}
          defaultInvitees={dmContext?.participants ?? []}
          dmContext={dmContext}
          onConfirm={handleTopicConfirm}
          onCancel={() => setShowTopicDialog(false)}
        />
      )}

      {previewFrame && (
        <FrameLightbox frame={previewFrame} onClose={() => setPreviewFrame(null)} />
      )}
    </>
  )
}
