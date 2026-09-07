import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { IconBold, IconItalic, IconLink, IconUnderline } from '@tabler/icons-react'
// Straight from the shared package rather than through Peek's re-export files
// (`./IconButton`, `@/lib/utils`), which exist only to keep older import paths
// working — a new file should name where the component actually lives.
import { Menu } from '@estiva-app/ui'
import { cn } from '@/lib/utils'
import { IconButton } from './IconButton'
import { TextInput } from './TextInput'
import { MARKS, toggleMark, shortcutLabel, currentLink, applyLink, type MarkId } from '@/lib/composerFormats'
import { keepSelection, releaseSelection } from '@/extensions/keptSelection'

/**
 * Bold / italic / underline / link over selected text — PEE-18, PEE-19.
 *
 * The marks apply to a run you have already written, which is why they are
 * not in the `/` menu: typing `/` replaces the selection, so by definition
 * there is nothing selected to apply them to.
 *
 * **The chrome is the shared `Menu`** — the same component `ConversationMoreMenu`
 * renders, so this reads as the same app rather than a second popover style.
 * It is laid out as a row instead of a column through `className`, which `cn`
 * merges last. Two things come free with it: the panel portals out of the
 * composer, so no overflow can clip it, and `position` is clamped on screen by
 * the package rather than by arithmetic here.
 *
 * **Two faces** (PEE-19 — Katerina, 2026-09-07, after Linear). `marks` is the
 * row of four buttons. `link` is one text field for the address: it opens from
 * the Link button, and opens by itself when the settled selection sits inside
 * a link, with that link's address in it. There is no open, embed or delete
 * button, by her call: the field is the whole control.
 *
 * **What applies the field** (her rule, same day): Enter, and clicking away —
 * anywhere outside the toolbar, the editor included. Enter on an empty field
 * removes the link; clicking away with an empty field changes nothing, since
 * removing is deliberate and leaving is not. Escape drops what was typed and
 * puts the caret back. Once applied, the caret lands after the link, and
 * typing goes on as plain text — the mark is not inclusive (editorKit).
 *
 * While the field has focus the editor has not, so everything below that
 * hides the toolbar on blur or on an empty editor selection stands down in
 * `link` mode. The editor keeps its selection while unfocused; `focus()` in
 * the apply command puts it back.
 *
 * **Why it waits.** Showing on every selection change put the toolbar under the
 * pointer mid-drag, and made it blink on a plain click — ProseMirror restores
 * the previous selection when the editor takes focus and collapses it a tick
 * later, so there is a real, non-empty range in between. Both go away by
 * refusing to show while the pointer is down and re-reading the selection after
 * a short settle rather than trusting the event that woke us.
 */

const ICONS: Record<MarkId, typeof IconBold> = {
  bold: IconBold,
  italic: IconItalic,
  underline: IconUnderline,
}

type Mode = 'marks' | 'link'

/** How long a selection must stand still before the toolbar appears. */
const SETTLE_MS = 250
const GAP = 8
/** Each face's box, measured in Storybook (2026-09-07) — the toolbar is
 *  centred over the selection and hung this far above it. The field's height
 *  is the package TextInput's own: 14px × 1.4 line, 8px padding, 1px border. */
const SIZE: Record<Mode, { width: number; height: number }> = {
  marks: { width: 118, height: 34 },
  link: { width: 274, height: 47.6 },
}

export function SelectionToolbar({ editor }: { editor: Editor | null }) {
  /** The selection's top edge and horizontal centre; the face decides the rest. */
  const [anchor, setAnchor] = useState<{ top: number; centre: number } | null>(null)
  const [mode, setMode] = useState<Mode>('marks')
  const [url, setUrl] = useState('')
  // Re-render as marks turn on and off while the caret moves through the
  // selection, so the pressed states stay honest.
  const [, setTick] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pointerDown = useRef(false)
  const field = useRef<HTMLInputElement>(null)
  /** What the field holds while it is open; null while it is closed. The
   *  listeners below are bound once, so they read this rather than state. */
  const draft = useRef<string | null>(null)
  // Read by the same listeners. Kept in an effect, declared before the focus
  // effect below so the ref already says `link` when the field's focus blurs
  // the editor.
  const modeRef = useRef<Mode>('marks')
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  const hide = useCallback(() => {
    clearTimeout(timer.current)
    draft.current = null
    if (editor) releaseSelection(editor)
    setAnchor(null)
    setMode('marks')
  }, [editor])

  /**
   * Leaving the field applies it (Enter or a click away). An address links the
   * words and the caret moves past them; an empty field on the way out is a
   * shrug, not a removal. Idempotent: the outside click reaches this twice,
   * once from the editor press and once from the Menu's own listener.
   */
  const commit = useCallback(() => {
    const text = draft.current
    if (text === null || !editor) return
    draft.current = null
    if (text.trim() && applyLink(editor, text)) {
      editor.commands.setTextSelection(editor.state.selection.to)
    }
    hide()
  }, [editor, hide])

  /** Read the selection as it is *now* and place the toolbar, or hide it. */
  const settle = useCallback(() => {
    if (!editor || editor.isDestroyed) return
    // Keeping the selection drawn is itself a transaction, which schedules
    // this; by then the field has the focus, and reading `hasFocus()` here
    // would close it.
    if (modeRef.current === 'link') return
    const { state, view } = editor
    const { empty, from, to } = state.selection
    if (empty || from === to || !view.hasFocus() || pointerDown.current) {
      setAnchor(null)
      setMode('marks')
      return
    }
    const start = view.coordsAtPos(from)
    const end = view.coordsAtPos(to)
    const centre = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2
    // Words that are already a link open on the field, with their address in it.
    const inLink = editor.isActive('link')
    const address = inLink ? currentLink(editor) : ''
    draft.current = inLink ? address : null
    // The field is about to take the focus; the words stay highlighted.
    if (inLink) keepSelection(editor)
    setMode(inLink ? 'link' : 'marks')
    setUrl(address)
    setAnchor({ top: start.top, centre })
  }, [editor])

  useEffect(() => {
    if (!editor) return

    const schedule = () => {
      // The field owns the keyboard and the focus; the editor's own events
      // stand down until it closes.
      if (modeRef.current === 'link') return
      setTick((t) => t + 1)
      clearTimeout(timer.current)
      // A collapsed selection hides at once — waiting to hide is what made the
      // click blink. Only *showing* is deferred.
      if (editor.state.selection.empty) {
        setAnchor(null)
        return
      }
      timer.current = setTimeout(settle, SETTLE_MS)
    }

    // The field taking focus is the one blur that must not hide us.
    const onBlur = () => {
      if (modeRef.current !== 'link') hide()
    }

    // Only a press *inside the editor* starts a selection. A press on the
    // toolbar itself must not hide it — doing so unmounted the button before
    // its click could land, so nothing ever applied.
    const startsSelection = (e: MouseEvent) =>
      e.target instanceof Node && editor.view.dom.contains(e.target)

    const onPointerDown = (e: MouseEvent) => {
      if (!startsSelection(e)) return
      // A press in the editor while the field is open is a click away: apply
      // first, before the editor moves the caret under the press.
      commit()
      pointerDown.current = true
      hide()
    }
    const onPointerUp = () => {
      if (!pointerDown.current) return
      pointerDown.current = false
      schedule()
    }

    editor.on('selectionUpdate', schedule)
    editor.on('transaction', schedule)
    editor.on('blur', onBlur)
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('mouseup', onPointerUp, true)

    return () => {
      clearTimeout(timer.current)
      editor.off('selectionUpdate', schedule)
      editor.off('transaction', schedule)
      editor.off('blur', onBlur)
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('mouseup', onPointerUp, true)
    }
  }, [editor, settle, hide, commit])

  // The field takes focus once it is on screen. Not `autoFocus`, and not in
  // the same frame: the Menu renders once hidden to measure itself, and a
  // hidden input cannot take focus — measured 2026-09-07, the field opened
  // unfocused on a re-selected link. An address already in it is selected
  // whole, so typing replaces it.
  useEffect(() => {
    if (mode !== 'link' || !anchor) return
    const frame = requestAnimationFrame(() => {
      field.current?.focus()
      field.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [mode, anchor])

  if (!editor || !anchor) return null

  const openField = () => {
    const address = currentLink(editor)
    draft.current = address
    keepSelection(editor)
    setUrl(address)
    setMode('link')
  }
  /** Enter. Unlike a click away, an empty field here means remove. */
  const submit = () => {
    if (!url.trim()) {
      applyLink(editor, '')
      hide()
      editor.commands.focus()
      return
    }
    commit()
  }
  const discard = () => {
    hide()
    editor.commands.focus()
  }

  const size = SIZE[mode]
  const placement = { top: anchor.top - size.height - GAP, left: anchor.centre - size.width / 2 }

  return (
    <Menu
      onClose={commit}
      position={placement}
      // A row rather than a column. `cn` merges these last, so they win over
      // Menu's own `flex-col`, `min-w-[180px]` and `p-2`.
      className="w-auto min-w-0 flex-row items-center gap-1 p-1"
    >
      {mode === 'link' ? (
        <TextInput
          ref={field}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            draft.current = e.target.value
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              // Before the Menu's own Escape, which would apply instead.
              e.stopPropagation()
              discard()
            }
          }}
          placeholder="Enter link URL"
          aria-label="Link URL"
          className="w-[264px]"
        />
      ) : (
        <>
          {MARKS.map((mark) => {
            const Icon = ICONS[mark.id]
            const active = editor.isActive(mark.id)
            return (
              <IconButton
                key={mark.id}
                aria-label={mark.label}
                aria-pressed={active}
                tooltip={mark.label}
                tooltipShortcut={shortcutLabel(mark.keys)}
                className={cn(active && 'bg-bg-active text-text-primary')}
                // Keep the selection: focus must not leave the editor on press.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggleMark(editor, mark.id)}
              >
                <Icon size={16} stroke={1.5} />
              </IconButton>
            )
          })}
          <IconButton
            aria-label="Link"
            tooltip="Link"
            onMouseDown={(e) => e.preventDefault()}
            onClick={openField}
          >
            <IconLink size={16} stroke={1.5} />
          </IconButton>
        </>
      )}
    </Menu>
  )
}
