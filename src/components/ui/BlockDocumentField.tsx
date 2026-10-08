import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { TextSelection } from '@tiptap/pm/state'
import {
  documentForEditing,
  publishableFromEditor,
  toEditorDocument,
  type ContentFormat,
  type EditorDocument,
} from '@estiva-app/protocol'
import { richTextClassName } from '@estiva-app/ui'
import { AttachmentNode, BlockId, CodeBlockColours, ReferenceNode, SelectionToolbar, UnknownBlock } from '@estiva-app/ui/editor'

/**
 * Another app's block-document field, edited where it is read (MAN-9).
 *
 * Ship declares `describe-issue` and `describe-project` with `format:
 * 'estiva-blocks-1'`, and Peek's own prose editor could not take them: it holds
 * marker text, which carries no block ids, so a save through it re-minted every
 * id and detached each comment anchored to one of the blocks (SPEC §13.6). This
 * is the other editor — the one Ship's description is — assembled from the
 * shared kit rather than copied: `@estiva-app/protocol`'s translation turns the
 * stored §13.3 document into editor JSON with its ids and back, and
 * `@estiva-app/ui/editor`'s nodes carry the id on every block, keep a block this
 * editor has no design for whole, and hold a reference and a file as atoms.
 * StarterKit and TableKit are the rest of the schema; without TableKit a save
 * would drop every table.
 *
 * **It behaves as Ship's `LiveDescription` does** (Katerina, 29 September):
 * always an editor, no reading/writing switch, saved when you leave it — on
 * blur and on unmount, never while typing — and Escape leaves and keeps the
 * text. A refused save keeps the text, and the card says why. Someone else's
 * edit arriving while you are not in it is loaded; while you are, it waits.
 *
 * **References and files draw as text**, not as their widgets: the reason
 * `ForeignBody` gives for not nesting a widget inside a widget's body holds for
 * the editor of that body too. Neither is lost — the atoms keep every attribute
 * — they are only drawn plainly.
 */
export function BlockDocumentField({
  value,
  format,
  label,
  onCommit,
}: {
  /** The folded current value, as the object resolved it. */
  value: string
  /** `ResolvedSlot.format` — which content model `value` is written in. */
  format: ContentFormat
  /** The editor's accessible name. */
  label: string
  /** Publishes the edit; resolves false when it was refused, so the next leave retries. */
  onCommit: (value: string, contentFormat?: string) => Promise<boolean> | boolean
}) {
  const [empty, setEmpty] = useState(value.trim() === '')
  const committing = useRef(false)
  const saved = useRef(value)
  const typed = useRef<EditorDocument | null>(null)

  const save = useCallback(
    async (doc: EditorDocument | null) => {
      if (committing.current || !doc) return
      const next = publishableFromEditor(doc)
      if (next.value === saved.current) return
      committing.current = true
      try {
        if (await onCommit(next.value, next.contentFormat)) saved.current = next.value
      } finally {
        committing.current = false
      }
    },
    [onCommit],
  )
  /*
    The latest `save`, for the two callers that must not re-subscribe: the
    editor's `onBlur`, created once, and the unmount below. A cleanup keyed on
    `save` itself ran on every render the card's inline `onCommit` caused —
    publishing mid-typing whenever the conversation re-rendered.
  */
  const latestSave = useRef(save)
  useEffect(() => {
    latestSave.current = save
  }, [save])
  // Read once: the editor takes `content` only when it is created.
  const [initial] = useState(() => toEditorDocument(documentForEditing(value, format)))

  const editor = useEditor(
    {
      extensions: [
        // Ship's schema exactly: a mark or level it has no design for would
        // be one this editor could write and Ship could not show.
        // The code block is the package's, coloured by language as it is when read (estiva-ui 0.64.0).
        StarterKit.configure({ link: false, strike: false, heading: { levels: [1, 2, 3] }, codeBlock: false }),
        CodeBlockColours,
        TableKit.configure({ table: { resizable: false } }),
        BlockId,
        ReferenceNode,
        UnknownBlock,
        AttachmentNode,
      ],
      content: initial,
      editorProps: {
        attributes: {
          'aria-label': label,
          role: 'textbox',
          'aria-multiline': 'true',
          // One step down, as `ForeignBody` draws the same body in a card.
          class: richTextClassName('small', 'outline-none'),
        },
        handleKeyDown: (view, event) => {
          if (event.key !== 'Escape') return false
          // A selection first collapses, so Escape out of a toolbar pick does not leave.
          const { selection, tr } = view.state
          if (!selection.empty) {
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, selection.to)))
            return true
          }
          view.dom.blur()
          return true
        },
      },
      onUpdate: ({ editor: e }) => {
        typed.current = e.getJSON() as EditorDocument
        setEmpty(e.isEmpty)
      },
      onBlur: () => void latestSave.current(typed.current),
    },
    [],
  )

  /*
    A newer value from the relay — someone else's edit, or the re-read after
    this one's own save. `saved` is what this editor last published, so its own
    echo is recognised and never reloads over the caret; anything else loads
    only while nobody is typing here.
  */
  useEffect(() => {
    if (!editor || editor.isDestroyed || value === saved.current || editor.isFocused || committing.current) return
    editor.commands.setContent(toEditorDocument(documentForEditing(value, format)), { emitUpdate: false })
    saved.current = value
    typed.current = null
    setEmpty(value.trim() === '')
  }, [editor, value, format])

  useEffect(() => () => void latestSave.current(typed.current), [])

  return (
    <div className="relative">
      {/* No box and no fill: the text reads as the body it is, and the cursor is the only sign it is editable. */}
      <EditorContent editor={editor} className="cursor-text" data-foreign-body="editing" />
      {/* Muted words over an empty editor, as the composer does — the action's own label, as a text action's box has. */}
      {empty && (
        <span aria-hidden className="pointer-events-none absolute left-0 top-0 text-caption text-text-muted">
          {label}…
        </span>
      )}
      <SelectionToolbar editor={editor} marks={['bold', 'italic', 'underline', 'code']} />
    </div>
  )
}
