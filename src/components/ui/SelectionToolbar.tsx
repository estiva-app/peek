import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { IconBold, IconItalic, IconUnderline } from '@tabler/icons-react'
// Straight from the shared package rather than through Peek's re-export files
// (`./IconButton`, `@/lib/utils`), which exist only to keep older import paths
// working — a new file should name where the component actually lives.
import { cn, IconButton, Menu } from '@estiva-app/ui'
import { MARKS, toggleMark, shortcutLabel, type MarkId } from '@/lib/composerFormats'

/**
 * Bold / italic / underline over selected text — PEE-18.
 *
 * The three marks apply to a run you have already written, which is why they
 * are not in the `/` menu: that menu only opens when the composer starts with
 * `/`, so by definition there is nothing selected to apply them to.
 *
 * **The chrome is the shared `Menu`** — the same component `ConversationMoreMenu`
 * renders, so this reads as the same app rather than a second popover style.
 * It is laid out as a row instead of a column through `className`, which `cn`
 * merges last. Two things come free with it: the panel portals out of the
 * composer, so no overflow can clip it, and `position` is clamped on screen by
 * the package rather than by arithmetic here.
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

/** How long a selection must stand still before the toolbar appears. */
const SETTLE_MS = 250
/** The toolbar's own height, to hang it above the selection rather than over it. */
const HEIGHT = 34
const GAP = 8
const WIDTH = 104

export function SelectionToolbar({ editor }: { editor: Editor | null }) {
  const [placement, setPlacement] = useState<{ top: number; left: number } | null>(null)
  // Re-render as marks turn on and off while the caret moves through the
  // selection, so the pressed states stay honest.
  const [, setTick] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pointerDown = useRef(false)

  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setPlacement(null)
  }, [])

  /** Read the selection as it is *now* and place the toolbar, or hide it. */
  const settle = useCallback(() => {
    if (!editor || editor.isDestroyed) return
    const { state, view } = editor
    const { empty, from, to } = state.selection
    if (empty || from === to || !view.hasFocus() || pointerDown.current) {
      setPlacement(null)
      return
    }
    const start = view.coordsAtPos(from)
    const end = view.coordsAtPos(to)
    const centre = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2
    setPlacement({ top: start.top - HEIGHT - GAP, left: centre - WIDTH / 2 })
  }, [editor])

  useEffect(() => {
    if (!editor) return

    const schedule = () => {
      setTick((t) => t + 1)
      clearTimeout(timer.current)
      // A collapsed selection hides at once — waiting to hide is what made the
      // click blink. Only *showing* is deferred.
      if (editor.state.selection.empty) {
        setPlacement(null)
        return
      }
      timer.current = setTimeout(settle, SETTLE_MS)
    }

    // Only a press *inside the editor* starts a selection. A press on the
    // toolbar itself must not hide it — doing so unmounted the button before
    // its click could land, so nothing ever applied.
    const startsSelection = (e: MouseEvent) =>
      e.target instanceof Node && editor.view.dom.contains(e.target)

    const onPointerDown = (e: MouseEvent) => {
      if (!startsSelection(e)) return
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
    editor.on('blur', hide)
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('mouseup', onPointerUp, true)

    return () => {
      clearTimeout(timer.current)
      editor.off('selectionUpdate', schedule)
      editor.off('transaction', schedule)
      editor.off('blur', hide)
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('mouseup', onPointerUp, true)
    }
  }, [editor, settle, hide])

  if (!editor || !placement) return null

  return (
    <Menu
      onClose={hide}
      position={placement}
      // A row of icons rather than a column of rows. `cn` merges these last, so
      // they win over Menu's own `flex-col`, `min-w-[180px]` and `p-2`.
      className="w-auto min-w-0 flex-row items-center gap-1 p-1"
    >
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
    </Menu>
  )
}
