/**
 * Mark a message as a highlight — the toolbar button and the picker it opens.
 *
 * Written inline in `ComposeBox` and nowhere else, so a message could be
 * marked as an Insight when it was written and never after. The edit boxes
 * could always *keep* a highlight — `extractHighlightType` reads one back on
 * save — and had no way to add, change or drop one. It is here once now, and
 * all three call it: the move `AttachFileButton` made for the paperclip.
 *
 * **The picker is the package's `Menu`.** The copy this replaces was a
 * `MenuPanel` placed by hand with `absolute left-0 bottom-full mb-1`, closing
 * through its own `mousedown` listener, and its comment argued that `Menu`
 * "would fight it" — which was true only of the hand-placement it was
 * defending. `Menu` anchored to the box lands in exactly the same place:
 * `fitMenu` opens upward when the room below is smaller than the panel (which
 * is always, for a composer sitting at the foot of the screen) and hangs the
 * panel's bottom edge `GAP` above the anchor's top — and the package's GAP is
 * 4px, which is what `mb-1` was. Measured before and after, both at 180 ×
 * 175.97 with the same 4px, same left edge (2026-09-08).
 *
 * What the app stops owning by making the trade: the Escape key, the
 * outside-click, the portal, and being cut off at an edge. What it gains: an
 * edit box halfway down a scrolling list is not the composer at the foot of
 * the page, so the picker opens *below* the box there when that is where the
 * room is, and closes when the list scrolls out from under it. Neither was
 * possible while the panel was a child of the box.
 *
 * `container` is the box to hang from — the composer, or the edit box — not
 * the button. That is the anchor the old arithmetic used, and keeping it is
 * why the composer does not move a pixel.
 */
import { useEffect, useState, type RefObject } from 'react'
import { IconHighlight } from '@tabler/icons-react'
import type { Editor } from '@tiptap/react'
import { Menu, MenuItem } from '@estiva-app/ui'
import { IconButton } from './IconButton'
import { HighlightSwatch } from './HighlightPill'
import { insertHighlightTag } from '@/extensions/highlight'
import { HIGHLIGHT_META, type HighlightType } from '@/api'

const TYPES: HighlightType[] = ['insight', 'concern', 'conclusion', 'question', 'summary']

export function HighlightButton({
  editor,
  container,
}: {
  editor: Editor | null
  /** The box the picker hangs from — the composer, or the edit box. */
  container: RefObject<HTMLElement | null>
}) {
  const [open, setOpen] = useState(false)

  /* A click on a highlight tag already in the text opens the picker that owns
     it. The tag's node view is inside the editor and cannot know which of the
     three boxes it is in, so it shouts and each picker answers only for its
     own. */
  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent).detail as HTMLElement | undefined
      if (target && container.current?.contains(target)) setOpen(true)
    }
    window.addEventListener('highlight-tag-click', handler)
    return () => window.removeEventListener('highlight-tag-click', handler)
  }, [container])

  return (
    <>
      <IconButton
        aria-label="Highlight"
        tooltip="Mark as Highlight"
        // The menu's outside-click exit listens on `mousedown`, so a trigger
        // that toggles on `click` would close and reopen in one press —
        // Menu.mdx's "trigger trap".
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
      >
        <IconHighlight size={16} stroke={1.5} />
      </IconButton>
      {open && (
        <Menu onClose={() => setOpen(false)} anchor={container.current} className="w-[180px]">
          {TYPES.map((type) => (
            <MenuItem
              key={type}
              leading={<HighlightSwatch type={type} />}
              label={HIGHLIGHT_META[type].label}
              // On the press, not the click, and the default prevented: the
              // caret must not leave the editor to reach the picker.
              onMouseDown={(e) => {
                e.preventDefault()
                if (editor) insertHighlightTag(editor, type)
                setOpen(false)
              }}
            />
          ))}
        </Menu>
      )}
    </>
  )
}
