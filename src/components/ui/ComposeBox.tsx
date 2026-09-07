import { useState, useRef, useEffect } from 'react'
import { encodeNpub } from '@estiva-app/protocol'
import { registerActiveComposer, unregisterComposer } from '@/lib/composerRegistry'
import { browserDrafts, type DraftStore } from '@/lib/drafts'
import { textToTiptapContent } from '@/lib/textParsing'
import { useEditor, EditorContent } from '@tiptap/react'
import { peekStarterKit } from '@/extensions/editorKit'
import { PeekMention, UrgentMention, TopicMention, FileMention, isSuggestionActive } from '@/extensions/mention'
import { ResolutionBlock, extractResolution } from '@/extensions/resolution'
import { HighlightTag, extractHighlightType, insertHighlightTag } from '@/extensions/highlight'
import { IconPaperclip, IconSquareForbid2, IconArrowUp, IconHighlight, IconX, IconLoader2, IconAlertCircle } from '@tabler/icons-react'
import { IconButton } from './IconButton'
import { Kbd, MenuItem, MenuPanel } from '@estiva-app/ui'
import { HighlightSwatch } from './HighlightPill'
import { FrameArt } from './FrameArt'
import { FrameLightbox } from '../FrameLightbox'
import { cn } from '@/lib/utils'
import { HIGHLIGHT_META, hasConvex, useUploadActions, type HighlightType, type UploadedFile } from '@/api'
import { frameById, frameBreadcrumb, type FigmaFrame } from '@/api'
import { FILE_ACCEPT_ATTR, validateFile, isImageAttachment, formatBytes, fileTypeLabel } from '@/lib/fileAttachments'
import { serializeTextChild } from '@/lib/textParsing'
import { SelectionToolbar } from './SelectionToolbar'
import { SlashCommands } from '@/extensions/slashCommands'

export interface SendPayload {
  text: string
  resolution?: { message: string }
  highlightType?: HighlightType
  /** Figma frame ids attached via the command launcher's find flow. */
  attachments?: string[]
  /** Real uploaded files (already in Convex storage — Phase 5). */
  files?: UploadedFile[]
}

/** One picked file's lifecycle in the composer. */
interface PendingUpload {
  localId: string
  name: string
  size: number
  contentType: string
  status: 'uploading' | 'done' | 'error'
  error?: string
  uploaded?: UploadedFile
}

let uploadSeq = 0

interface ComposeBoxProps {
  onSend?: (payload: SendPayload) => void
  /**
   * Where an unsent message belongs — CON-10. Built with `draftKeys`.
   *
   * Omitted means nothing is kept, which is right for a composer with no
   * stable destination — the huddle creator has no huddle yet, and a draft that
   * cannot be keyed correctly is worse than none, because it comes back
   * somewhere it was not written.
   */
  draftKey?: string
  /** The store. Injected so a test needs no browser; defaults to `localStorage`. */
  drafts?: DraftStore
  placeholder?: 'default' | 'reply'
  /** Names this composer as a launcher target ("Reply to Alice", "#Topic").
   *  Shown in the command launcher's context chip and the Figma attach footer. */
  contextLabel?: string
  className?: string
}

function serializeInline(node: { forEach: (cb: (child: { type: { name: string }; attrs: Record<string, string>; text?: string; marks?: ReadonlyArray<{ type: { name: string }; attrs?: Record<string, unknown> }> }) => void) => void }): string {
  let text = ''
  node.forEach((child) => {
    if (child.type.name === 'hardBreak') {
      text += '\n'
    } else if (child.type.name === 'mention') {
      // SPEC §13.1 — a key, when we have one. `label` is what a person typed
      // and reads well; it is also the thing that goes stale on a rename and
      // means nothing to another app, so it is the fallback rather than the
      // form. Somebody with no Estiva ID key still mentions by name, which is
      // exactly what every existing message already does.
      text += child.attrs.pubkey ? `nostr:${encodeNpub(child.attrs.pubkey)}` : `@${child.attrs.label}`
    } else if (child.type.name === 'urgentMention') {
      // The urgency is Peek's own affordance and has no wire form, so an
      // urgent mention of somebody with a key is still just a mention of them.
      text += child.attrs.pubkey ? `nostr:${encodeNpub(child.attrs.pubkey)}` : `!@${child.attrs.label}`
    } else if (child.type.name === 'topicMention') {
      text += `[${child.attrs.label}]`
    } else if (child.type.name === 'fileMention') {
      text += `[${child.attrs.label}]`
    } else if (child.type.name === 'highlightTag') {
      // Skip - extracted as metadata, not serialized into text
    } else {
      // Marks, and a link as `[label](url)` — one writer with the edit path
      // (textParsing), so the two cannot disagree about a link. PEE-19.
      text += serializeTextChild(child)
    }
  })
  return text
}

function serializeToText(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return ''
  const lines: string[] = []
  editor.state.doc.forEach((node) => {
    // Skip resolution blocks - they are consumed by the resolve action
    if (node.type.name === 'resolutionBlock') return
    if (node.type.name === 'paragraph') {
      lines.push(serializeInline(node))
    } else if (node.type.name === 'heading') {
      const text = serializeInline(node)
      if (text.trim()) lines.push(`${'#'.repeat(node.attrs.level === 2 ? 2 : 1)} ${text}`)
    } else if (node.type.name === 'bulletList') {
      node.forEach((li) => {
        li.forEach((liChild) => {
          if (liChild.type.name === 'paragraph') {
            lines.push(`- ${serializeInline(liChild)}`)
          }
        })
      })
    } else if (node.type.name === 'orderedList') {
      let idx = 1
      node.forEach((li) => {
        li.forEach((liChild) => {
          if (liChild.type.name === 'paragraph') {
            lines.push(`${idx}. ${serializeInline(liChild)}`)
            idx++
          }
        })
      })
    } else if (node.type.name === 'blockquote') {
      node.forEach((qChild) => {
        if (qChild.type.name === 'paragraph') {
          lines.push(`> ${serializeInline(qChild)}`)
        }
      })
    }
  })
  return lines.join('\n').trim()
}


const DEFAULT_DRAFTS = browserDrafts()

export function ComposeBox({ onSend, placeholder = 'default', contextLabel, draftKey, drafts = DEFAULT_DRAFTS, className }: ComposeBoxProps) {
  const [isEmpty, setIsEmpty] = useState(true)
  const [hasUrgent, setHasUrgent] = useState(false)
  const [hasHighlight, setHasHighlight] = useState(false)
  const [attachedFrameIds, setAttachedFrameIds] = useState<string[]>([])
  const [previewFrame, setPreviewFrame] = useState<FigmaFrame | null>(null)
  const [pendingFiles, setPendingFiles] = useState<PendingUpload[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { uploadFile, deleteUpload } = useUploadActions()
  const composeRef = useRef<HTMLDivElement>(null)

  const sendFnRef = useRef(onSend)
  sendFnRef.current = onSend

  /* Read inside the editor's stable handlers, which close over their first
     render — the same reason `sendFnRef` exists. */
  const draftKeyRef = useRef(draftKey)
  draftKeyRef.current = draftKey
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts

  // Mirror attachments into refs so the editorProps Enter handler (a stable
  // closure) always sees the current lists.
  const attachedFramesRef = useRef<string[]>([])
  attachedFramesRef.current = attachedFrameIds
  const pendingFilesRef = useRef<PendingUpload[]>([])
  pendingFilesRef.current = pendingFiles

  /** Files that finished uploading and are ready to send. */
  const readyFiles = (): UploadedFile[] =>
    pendingFilesRef.current.filter((f) => f.status === 'done' && f.uploaded).map((f) => f.uploaded!)
  const isUploading = pendingFiles.some((f) => f.status === 'uploading')

  const handlePickFiles = (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      const localId = `u_${++uploadSeq}`
      const err = validateFile(file)
      if (err) {
        setPendingFiles((prev) => [...prev, { localId, name: file.name, size: file.size, contentType: file.type, status: 'error', error: err }])
        continue
      }
      setPendingFiles((prev) => [...prev, { localId, name: file.name, size: file.size, contentType: file.type, status: 'uploading' }])
      uploadFile(file).then(
        (uploaded) =>
          setPendingFiles((prev) => prev.map((f) => (f.localId === localId ? { ...f, status: 'done', uploaded } : f))),
        (e: unknown) =>
          setPendingFiles((prev) =>
            prev.map((f) => (f.localId === localId ? { ...f, status: 'error', error: e instanceof Error ? e.message : 'Upload failed.' } : f)),
          ),
      )
    }
  }

  const removePendingFile = (localId: string) => {
    setPendingFiles((prev) => {
      const slot = prev.find((f) => f.localId === localId)
      // A successfully-uploaded blob that never got sent must be cleaned up.
      if (slot?.uploaded) deleteUpload(slot.uploaded.storageId)
      return prev.filter((f) => f.localId !== localId)
    })
  }

  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  const editor = useEditor({
    extensions: [
      peekStarterKit,
      PeekMention,
      UrgentMention,
      TopicMention,
      FileMention,
      ResolutionBlock,
      HighlightTag,
      SlashCommands,
    ],
    editorProps: {
      attributes: {
        class: 'outline-none w-full bg-transparent text-sm text-text-primary leading-[1.4] break-words min-h-[20px]',
        style: 'caret-color: var(--text-primary)',
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          if (isSuggestionActive()) return false
          const ed = editorRef.current!
          const text = serializeToText(ed)
          const resolution = extractResolution(ed)
          const hl = extractHighlightType(ed)
          const attachments = attachedFramesRef.current
          const files = readyFiles()
          // Hold Enter until in-flight uploads settle, so files aren't dropped.
          if (pendingFilesRef.current.some((f) => f.status === 'uploading')) return true
          if (text || resolution.hasResolution || attachments.length > 0 || files.length > 0) {
            sendFnRef.current?.({
              text,
              resolution: resolution.hasResolution ? { message: resolution.resolutionMessage } : undefined,
              highlightType: hl,
              attachments: attachments.length > 0 ? [...attachments] : undefined,
              files: files.length > 0 ? files : undefined,
            })
            ed.commands.clearContent(true)
            /*
              Cleared with the composer, and that is weaker than Ship's rule.

              Ship keeps a draft when the relay refuses, because `act` reports
              the outcome. Peek's `onSend` returns nothing and the editor is
              emptied on Enter regardless — so a failed send already loses the
              text here, with or without drafts. Holding the draft back would
              mean re-offering a message that may well have been delivered,
              which is the worse of the two. Making `onSend` report its outcome
              is the fix, and it is a change to the send contract across five
              call sites rather than part of this.
            */
            if (draftKeyRef.current) draftsRef.current.clear(draftKeyRef.current)
            setAttachedFrameIds([])
            setPendingFiles([])
          }
          return true
        }
        // Shift+Enter: in list → split item (or exit if empty), else new paragraph
        if (event.key === 'Enter' && event.shiftKey) {
          const ed = editorRef.current
          if (!ed) return false
          const { $from } = view.state.selection
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              const listItem = $from.node(d)
              const isEmpty = listItem.textContent.length === 0
              if (isEmpty) {
                ed.commands.liftListItem('listItem')
              } else {
                ed.commands.splitListItem('listItem')
              }
              return true
            }
          }
          // In a quote: splitBlock continues it line by line; Shift+Enter on
          // an EMPTY quote line lifts out to a regular paragraph (mirrors how
          // an empty list item exits the list).
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
        return false
      },
    },
    content: '',
    autofocus: true,
    onUpdate({ editor }) {
      /*
        Keep the draft as the MARKER TEXT, not the editor's document — CON-10.

        A Tiptap doc is shaped by this app's schema at this version, so a draft
        stored as JSON could fail to load after a release that changes a node.
        Marker text is what would be sent (SPEC §13.2) and what the other app
        reads, so it survives both.
      */
      if (draftKeyRef.current) draftsRef.current.write(draftKeyRef.current, serializeToText(editor))
      const doc = editor.state.doc
      let hasNonParagraph = false
      let hasAtomNode = false
      let hasHl = false
      doc.forEach((node) => {
        // Headings count as paragraph-like: an empty heading is still "empty".
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') hasNonParagraph = true
      })
      doc.descendants((node) => {
        if (node.isAtom && node.type.name !== 'paragraph') hasAtomNode = true
        if (node.type.name === 'highlightTag') hasHl = true
        if (node.type.name === 'urgentMention') return // handled below
      })

      // "Empty" means no text AND no atoms except highlightTag
      const textLen = doc.textContent.length
      const onlyHighlight = hasHl && textLen === 0 && !hasNonParagraph
      const empty = textLen === 0 && !hasNonParagraph && !hasAtomNode
      setIsEmpty(empty || onlyHighlight)

      // Collapse leftover empty paragraphs to one (but keep highlight tag)
      if (empty && !hasAtomNode && doc.childCount > 1) {
        requestAnimationFrame(() => {
          editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] })
        })
      }

      let urgent = false
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'urgentMention') urgent = true
      })
      setHasUrgent(urgent)
      setHasHighlight(hasHl)

    },
  })

  /*
    Seed from the draft, and re-seed when the destination changes — CON-10.

    Keyed on `draftKey` rather than run once: this composer is reused as the
    route changes, so mounting is not the moment the destination changes.
    Seeding only on mount is exactly PEE-7's first symptom — "you switch to a
    different topic, the text is kept there, which is weird".

    Restored through `textToTiptapContent`, the same parser a pasted message
    goes through, so a draft with a heading or a list comes back as one rather
    than as its marker characters.
  */
  useEffect(() => {
    if (!editor) return
    const text = draftKey ? (drafts.read(draftKey) ?? '') : ''
    editor.commands.setContent(
      text ? textToTiptapContent(text) : { type: 'doc', content: [{ type: 'paragraph' }] },
    )
    setIsEmpty(!text)
    // `drafts` is deliberately not a dependency: a caller passing a fresh store
    // object each render would otherwise re-seed and wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, editor])

  editorRef.current = editor

  // Register with the global composer registry so the command launcher can
  // insert into "the compose box the user last touched" (focus wins; the most
  // recently mounted composer is the fallback).
  useEffect(() => {
    if (!editor) return
    const handle = {
      editor,
      label: contextLabel,
      attachFrames: (ids: string[]) =>
        setAttachedFrameIds((prev) => [...prev, ...ids.filter((id) => !prev.includes(id))]),
    }
    registerActiveComposer(handle)
    const onFocus = () => registerActiveComposer(handle)
    editor.on('focus', onFocus)
    return () => {
      editor.off('focus', onFocus)
      unregisterComposer(editor)
    }
  }, [editor, contextLabel])


  // Listen for tag clicks to reopen picker
  const [showHighlightPicker, setShowHighlightPicker] = useState(false)
  const highlightPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent).detail as HTMLElement | undefined
      // Only respond if the click came from within this ComposeBox
      if (target && composeRef.current?.contains(target)) {
        setShowHighlightPicker(true)
      }
    }
    window.addEventListener('highlight-tag-click', handler)
    return () => window.removeEventListener('highlight-tag-click', handler)
  }, [])

  // Close highlight picker on outside click
  useEffect(() => {
    if (!showHighlightPicker) return
    const close = (e: MouseEvent) => {
      if (highlightPickerRef.current?.contains(e.target as Node)) return
      setShowHighlightPicker(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showHighlightPicker])




  const handleSend = () => {
    if (!editor) return
    if (isUploading) return // wait for in-flight uploads
    const text = serializeToText(editor)
    const resolution = extractResolution(editor)
    const hl = extractHighlightType(editor)
    const files = readyFiles()
    if (!text && !resolution.hasResolution && attachedFrameIds.length === 0 && files.length === 0) return
    onSend?.({
      text,
      resolution: resolution.hasResolution ? { message: resolution.resolutionMessage } : undefined,
      highlightType: hl,
      attachments: attachedFrameIds.length > 0 ? attachedFrameIds : undefined,
      files: files.length > 0 ? files : undefined,
    })
    editor.commands.clearContent(true)
    editor.commands.focus()
    setIsEmpty(true)
    setHasUrgent(false)
    setHasHighlight(false)
    setAttachedFrameIds([])
    setPendingFiles([])
  }


  return (
    <div ref={composeRef} className={cn('relative', className)}>

      {/* Highlight picker (from toolbar button or tag click) */}
      {showHighlightPicker && (
        <div ref={highlightPickerRef} className="absolute left-0 bottom-full mb-1 z-50">
          {/* The shared box (2026-09-05) — a fourth hand-drawn copy of it
              lived here. Not `Menu`: this picker is placed against the
              composer and closes through the outside-click effect above, so
              a second Escape-and-outside-click owner would fight it. */}
          <MenuPanel className="w-[180px]">
            {(['insight', 'concern', 'conclusion', 'question', 'summary'] as HighlightType[]).map((type) => (
              <MenuItem
                key={type}
                leading={<HighlightSwatch type={type} />}
                label={HIGHLIGHT_META[type].label}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (editorRef.current) insertHighlightTag(editorRef.current, type)
                  setShowHighlightPicker(false)
                }}
              />
            ))}
          </MenuPanel>
        </div>
      )}

      <div className="relative bg-bg-inset border border-border-default focus-within:border-border-strong rounded-lg p-3 flex flex-col gap-4 transition-colors signal:transition-shadow signal:focus-within:border-border-focus signal:focus-within:shadow-[shadow:var(--focus-ring)]">
        {/* Editable area - left border when urgent or highlight */}
        <div data-composer-editor className={cn(
          'relative min-h-[20px] transition-all',
          hasUrgent && 'border-l-[4px] border-border-strong pl-2',
          !hasUrgent && hasHighlight && 'border-l-[4px] border-border-strong pl-2'
        )}>
          <EditorContent editor={editor} />
          {/* Bold / italic / underline / link over a selection. Rendered here rather
              than in the menu because those marks need something selected, and
              the `/` menu only opens on an empty composer. */}
          <SelectionToolbar editor={editor} />
          {isEmpty && !hasHighlight && (
            <div className="absolute inset-0 pointer-events-none flex items-center gap-1 text-sm text-text-muted leading-[1.4] flex-wrap">
              {placeholder === 'reply' ? (
                <span>Reply...</span>
              ) : (
                <>
                  <span>Start a new conversation or type</span>
                  <Kbd>/</Kbd>
                  <span>for commands</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Attached frames - preview cards below the text, removable, click to view */}
        {attachedFrameIds.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachedFrameIds.map((id) => {
              const frame = frameById(id)
              if (!frame) return null
              return (
                <div
                  key={id}
                  className="group relative flex flex-col w-[132px] rounded-lg border border-border-default bg-bg-elevated p-1.5 gap-1.5 cursor-pointer"
                  onClick={() => setPreviewFrame(frame)}
                >
                  <div className="h-20 rounded-md bg-bg-active flex items-center justify-center overflow-hidden">
                    <FrameArt frame={frame} className={frame.kind === 'mobile' ? 'h-[68px]' : 'w-[90%]'} />
                  </div>
                  <div className="flex flex-col gap-[1px] min-w-0">
                    <span className="text-[12px] font-medium leading-[1.3] text-text-primary truncate">{frame.name}</span>
                    <span className="text-[10px] leading-[1.2] text-text-secondary truncate">{frameBreadcrumb(frame)}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${frame.name}`}
                    className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-bg-elevated border border-border-strong flex items-center justify-center text-text-secondary hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      setAttachedFrameIds((prev) => prev.filter((fid) => fid !== id))
                    }}
                  >
                    <IconX size={11} stroke={1.75} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Pending / uploaded files — removable chips below the text. */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((f) => {
              const thumb = f.uploaded?.previewUrl
              const isImage = isImageAttachment(f.name, f.contentType)
              return (
                <div
                  key={f.localId}
                  className={cn(
                    'group relative flex items-center gap-2 w-[200px] rounded-lg border bg-bg-elevated p-1.5 pr-3',
                    f.status === 'error' ? 'border-error-default' : 'border-border-default',
                  )}
                >
                  <div className="size-9 rounded-md bg-bg-active flex items-center justify-center shrink-0 overflow-hidden text-text-secondary">
                    {f.status === 'uploading' ? (
                      <IconLoader2 size={16} stroke={1.5} className="animate-spin" />
                    ) : f.status === 'error' ? (
                      <IconAlertCircle size={16} stroke={1.5} className="text-error-default" />
                    ) : isImage && thumb ? (
                      <img src={thumb} alt={f.name} className="size-full object-cover" />
                    ) : (
                      <span className="text-[9px] font-semibold">{fileTypeLabel(f.name)}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-[1px] min-w-0">
                    <span className="text-[12px] font-medium leading-[1.3] text-text-primary truncate">{f.name}</span>
                    <span className={cn('text-[10px] leading-[1.2] truncate', f.status === 'error' ? 'text-error-default' : 'text-text-secondary')}>
                      {f.status === 'error' ? f.error : f.status === 'uploading' ? 'Uploading…' : formatBytes(f.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-bg-elevated border border-border-strong flex items-center justify-center text-text-secondary hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      removePendingFile(f.localId)
                    }}
                  >
                    <IconX size={11} stroke={1.75} />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {/* File upload needs storage — shown only against a live backend
                (the demo build hides it; the action only appears where it works). */}
            {hasConvex && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={FILE_ACCEPT_ATTR}
                  className="hidden"
                  onChange={(e) => {
                    handlePickFiles(e.target.files)
                    e.target.value = '' // let the same file be re-picked
                  }}
                />
                <IconButton tooltip="Attach file" aria-label="Attach file" onClick={() => fileInputRef.current?.click()}>
                  <IconPaperclip size={16} stroke={1.5} />
                </IconButton>
              </>
            )}
            <IconButton tooltip="Snooze" aria-label="Snooze">
              <IconSquareForbid2 size={16} stroke={1.5} />
            </IconButton>
            <IconButton
              aria-label="Highlight"
              tooltip="Mark as Highlight"
              onClick={() => setShowHighlightPicker((v) => !v)}
            >
              <IconHighlight size={16} stroke={1.5} />
            </IconButton>
          </div>

          {(() => {
            const hasReadyFile = pendingFiles.some((f) => f.status === 'done')
            const canSend = (!isEmpty || attachedFrameIds.length > 0 || hasReadyFile) && !isUploading
            return (
              <div className="flex items-center gap-2.5">
              <span className="hidden signal:inline font-mono text-[9px] tracking-[0.04em] text-text-muted select-none">
                Enter to send · Shift+Enter new line
              </span>
              {/* The shared IconButton's `primary`, which this button was a
                  hand-written copy of, class for class. Only the Signal glow
                  is Peek's, and it rides in on className — a disabled send
                  button does not glow. Focus must not leave the editor, so
                  the press is onMouseDown with the default prevented. */}
              <IconButton
                variant="primary"
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSend()
                }}
                disabled={!canSend}
                aria-label="Send"
                className={cn(canSend && 'signal:shadow-[shadow:var(--glow-accent)]')}
              >
                <IconArrowUp size={16} stroke={1.5} />
              </IconButton>
              </div>
            )
          })()}
        </div>
      </div>

      {previewFrame && (
        <FrameLightbox frame={previewFrame} onClose={() => setPreviewFrame(null)} />
      )}
    </div>
  )
}
