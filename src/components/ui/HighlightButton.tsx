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
 * defending. What the app stops owning by making the trade: the Escape key,
 * the outside-click, the portal, and being cut off at an edge.
 *
 * **It hangs from the button now, not from the box** (`@estiva-app/ui`
 * 0.10.0: a menu owns its trigger, and there is no `anchor` any more). The
 * panel used to be placed against the whole composer, so its left edge sat at
 * the composer's; it sits at the button's now. **That is a visible change and
 * the only one this file makes** — flagged for the screenshot diff rather than
 * hidden, because a menu belonging to the control that opens it is the point
 * of the move. The side is still whichever way there is room: above in the
 * composer at the foot of the page, below in an edit box near the top of a
 * list, which the hand-placed copy could never do.
 *
 * `open` stays controlled, because the button is not the only way in: clicking
 * a highlight tag already in the text opens the picker that owns that box.
 * `container` is still what answers "is that tag mine".
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
      {/* The `onMouseDown` guard that used to sit on this button is gone with
          the hand-rolled open state: Base UI owns the toggle, so there is no
          outside-press listener left for a click to fight (Menu.mdx's
          "trigger trap" was a symptom of the caller owning the state). */}
      <Menu
        trigger={
          <IconButton aria-label="Highlight" tooltip="Mark as Highlight">
            <IconHighlight size={16} stroke={1.5} />
          </IconButton>
        }
        open={open}
        onOpenChange={setOpen}
        className="w-[180px]"
      >
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
    </>
  )
}
