import { useState, useRef, useEffect } from 'react'
import { registerActiveComposer, unregisterComposer } from '@/lib/composerRegistry'
import { browserDrafts, type DraftStore } from '@/lib/drafts'
import { serializeTiptapToText, textToTiptapContent } from '@/lib/textParsing'
import { useEditor, EditorContent } from '@tiptap/react'
import { PEEK_EDITOR_CLASSES, peekEditorExtensions } from '@/extensions/peekEditor'
import { isSuggestionActive } from '@/extensions/mention'
import { extractResolution } from '@/extensions/resolution'
import { extractHighlightType } from '@/extensions/highlight'
import { IconArrowUp } from '@tabler/icons-react'
import { IconButton } from './IconButton'
import { AttachmentCard, Kbd, Toolbar } from '@estiva-app/ui'
import { cn } from '@/lib/utils'
import { useCanUpload, type HighlightType, type UploadedFile } from '@/api'
import { pastedImages, pendingAttachmentNote } from '@/lib/fileAttachments'
import { usePendingAttachments } from '@/lib/usePendingAttachments'
import { AttachFileButton } from './AttachFiles'
import { SelectionToolbar } from './SelectionToolbar'
import { HighlightButton } from './HighlightButton'
import { WRITING_BOX_CLASSES } from '@/components/ui/looks'

export interface SendPayload {
  text: string
  resolution?: { message: string }
  highlightType?: HighlightType
  /** Figma frame ids attached via the command launcher's find flow. */
  /** Real uploaded files (already in Convex storage — Phase 5). */
  files?: UploadedFile[]
}

interface ComposeBoxProps {
  /**
   * Send it. **Resolve `false` when nothing was written anywhere** — CON-10.
   *
   * `void` and `true` both mean sent, so a caller that does not know keeps the
   * old behaviour. Only an explicit `false` puts the text back.
   *
   * The outcome that matters is whether the message was *stored*, not whether
   * it reached the relay: a message Peek holds is on every Peek reader's screen,
   * and returning `false` for a failed relay mirror would re-offer text that has
   * already been posted.
   */
  onSend?: (payload: SendPayload) => void | boolean | Promise<void | boolean>
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

/*
  What a message is *sent* as is what an edit is *saved* as — one writer,
  `serializeTiptapToText`. This file used to carry its own copy of that walk,
  and the two drifted the way two copies do: RIC-11 taught the edit path to
  write a topic as `nostr:naddr…` and a message as `nostr:nevent…`, and the
  composer went on sending `[Title]` and dropping the message node on the
  floor, so the first pointer mention ever typed on production went out as
  the bracket form with nothing after it. PEE-19 had already made the same
  argument for a link; this finishes it.
*/
const serializeToText = serializeTiptapToText


const DEFAULT_DRAFTS = browserDrafts()

/**
 * The box for writing a new message or reply, with text formatting, files,
 * highlights and a send button; unsent text is kept for later.
 */
export function ComposeBox({ onSend, placeholder = 'default', contextLabel, draftKey, drafts = DEFAULT_DRAFTS, className }: ComposeBoxProps) {
  const [isEmpty, setIsEmpty] = useState(true)
  const [hasUrgent, setHasUrgent] = useState(false)
  const [hasHighlight, setHasHighlight] = useState(false)
  const uploads = usePendingAttachments()
  // Fixed for the composer's life: the conversation around it decides it.
  const canUpload = useCanUpload()
  const composeRef = useRef<HTMLDivElement>(null)

  const sendFnRef = useRef(onSend)
  sendFnRef.current = onSend

  /* Read inside the editor's stable handlers, which close over their first
     render — the same reason `sendFnRef` exists. */
  const draftKeyRef = useRef(draftKey)
  draftKeyRef.current = draftKey
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts

  /* The paste handler lives in `editorProps`, a closure from the first render
     — the same reason `sendFnRef` exists. */
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads

  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  const editor = useEditor({
    extensions: peekEditorExtensions,
    editorProps: {
      attributes: {
        class: PEEK_EDITOR_CLASSES,
        style: 'caret-color: var(--text-primary)',
      },
      /**
       * A screenshot on the clipboard becomes an attachment — PEE-20.
       *
       * Uploads need storage, so a paste is inert without a deployment, for
       * the same reason the paperclip is hidden there: an action only where
       * it can succeed. `pastedImages` decides what is an image and what is
       * a copy that merely carries one (text wins), and returning true keeps
       * the picture out of the document — it belongs in a chip, not in the
       * text. Anything it declines falls through untouched, which is how a
       * pasted link stays a link.
       */
      handlePaste: (_view, event) => {
        if (!canUpload) return false
        const images = pastedImages(event.clipboardData)
        if (images.length === 0) return false
        uploadsRef.current.add(images)
        return true
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          if (isSuggestionActive()) return false
          const ed = editorRef.current!
          const text = serializeToText(ed)
          const resolution = extractResolution(ed)
          const hl = extractHighlightType(ed)
          const files = uploadsRef.current.ready()
          // Hold Enter until in-flight uploads settle, so files aren't dropped.
          if (uploadsRef.current.isUploading) return true
          if (text || resolution.hasResolution || files.length > 0) {
            const sent = sendFnRef.current?.({
              text,
              resolution: resolution.hasResolution ? { message: resolution.resolutionMessage } : undefined,
              highlightType: hl,
              files: files.length > 0 ? files : undefined,
            })
            /*
              Cleared now, put back if it did not land — CON-10.

              Ship waits for the write and clears only on success. Peek cannot:
              the message appears in the list optimistically the instant Enter
              is pressed, so holding the text in the composer would show it
              twice. Clearing and restoring keeps the optimistic feel and still
              honours the rule that a refused send does not lose what was typed.

              This used to clear unconditionally, and said so: "a failed send
              already loses the text here, with or without drafts. Making
              `onSend` report its outcome is the fix." That is this.
            */
            ed.commands.clearContent(true)
            const key = draftKeyRef.current
            if (key) draftsRef.current.clear(key)
            uploadsRef.current.clear()
            void Promise.resolve(sent).then((ok) => {
              if (ok !== false) return
              // The draft store first, always: it survives the tab, and it is
              // the half that cannot be undone by what the person does next.
              if (key) draftsRef.current.write(key, text)
              /*
                The editor only if it is still empty. Somebody who started
                typing again in the round trip would otherwise have their new
                sentence replaced by the old one — worse than the loss this is
                fixing, and the draft above already holds it either way.
              */
              const current = editorRef.current
              if (current && !serializeToText(current).trim()) {
                current.commands.setContent(textToTiptapContent(text))
              }
            })
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
    const handle = { editor, label: contextLabel }
    registerActiveComposer(handle)
    const onFocus = () => registerActiveComposer(handle)
    editor.on('focus', onFocus)
    return () => {
      editor.off('focus', onFocus)
      unregisterComposer(editor)
    }
  }, [editor, contextLabel])



  const handleSend = () => {
    if (!editor) return
    if (uploads.isUploading) return // wait for in-flight uploads
    const text = serializeToText(editor)
    const resolution = extractResolution(editor)
    const hl = extractHighlightType(editor)
    const files = uploads.ready()
    if (!text && !resolution.hasResolution && files.length === 0) return
    onSend?.({
      text,
      resolution: resolution.hasResolution ? { message: resolution.resolutionMessage } : undefined,
      highlightType: hl,
      files: files.length > 0 ? files : undefined,
    })
    editor.commands.clearContent(true)
    editor.commands.focus()
    setIsEmpty(true)
    setHasUrgent(false)
    setHasHighlight(false)
    uploads.clear()
  }


  return (
    <div ref={composeRef} className={cn('relative', className)}>

      <div className={cn(WRITING_BOX_CLASSES, 'focus-within:border-border-strong transition-colors')}>
        {/* Editable area - left border when urgent or highlight */}
        <div data-composer-editor className={cn(
          'relative min-h-[20px] transition-all',
          hasUrgent && 'border-l-4 border-border-strong pl-2',
          !hasUrgent && hasHighlight && 'border-l-4 border-border-strong pl-2'
        )}>
          <EditorContent editor={editor} />
          {/* Bold / italic / underline / link over a selection. Rendered here
              rather than in the `/` menu because those marks need something
              selected, and typing `/` replaces a selection. (It is not that the
              menu needs an empty composer — it stopped needing that at PEE-18,
              and the note here still said so.) */}
          <SelectionToolbar editor={editor} />
          {isEmpty && !hasHighlight && (
            <div className="absolute inset-0 pointer-events-none flex items-center gap-1 text-body-2 text-text-muted flex-wrap">
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
        {/* Pending / uploaded files — removable chips below the text. */}
        {uploads.files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {uploads.files.map((f) => (
              <AttachmentCard
                key={f.localId}
                pending
                name={f.name}
                size={f.size}
                contentType={f.contentType}
                src={f.uploaded?.previewUrl}
                onRemove={() => uploads.remove(f.localId)}
                // CON-12 — the file uploaded here but not to the relay, so
                // only Peek can see it. Said before send, while it is still
                // something the sender can act on.
                {...pendingAttachmentNote({ status: f.status, error: f.error, shareError: f.uploaded?.shareError })}
              />
            ))}
          </div>
        )}

        {/* The row under the editor. The three things you do to a draft are
            one strip — one Tab stop, arrows along it (§4.2, D29) — and Send,
            which is the answer rather than a tool, keeps its own stop.
            `surface={false}`: the composer already draws the box these sit in. */}
        <div className="flex items-center justify-between">
          <Toolbar aria-label="Compose tools" surface={false} className="flex items-center gap-1">
            <AttachFileButton onPick={uploads.add} />
            <HighlightButton editor={editor} container={composeRef} />
          </Toolbar>

          {(() => {
            const hasReadyFile = uploads.files.some((f) => f.status === 'done')
            const canSend = (!isEmpty || hasReadyFile) && !uploads.isUploading
            return (
              <div className="flex items-center gap-2.5">
              <span className="hidden signal:inline font-mono text-menu font-normal tracking-wider text-text-muted select-none">
                Enter to send · Shift+Enter new line
              </span>
              {/* The shared IconButton's `primary`, which this button was a
                  hand-written copy of, class for class, with the package's
                  Signal `glow` (UIG-9) — a disabled send button does not glow.
                  Focus must not leave the editor, so the press is onMouseDown
                  with the default prevented.

                  The keyboard's press is the click (UIG-14, C5): Enter or Space
                  on the focused button fires a click with no pointer behind it
                  (`detail` 0), and that sends. A mouse press has already sent
                  on its way down, so its click (`detail` 1 or more) does
                  nothing — a click never sends twice. */}
              <IconButton
                variant="primary"
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSend()
                }}
                onClick={(e) => {
                  if (e.detail === 0) handleSend()
                }}
                disabled={!canSend}
                aria-label="Send"
                // Icon-only, so it says its word, and the key that does the same.
                tooltip="Send"
                tooltipShortcut="Enter"
                glow={canSend}
              >
                <IconArrowUp size={16} stroke={1.5} />
              </IconButton>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
