/**
 * Choose the card a reference gets under the message — none, compact or
 * detailed (SPEC §13.6.2, OPT-17, Widgets; Katerina 5 Oct: "none, compact or
 * detailed card").
 *
 * **For the reference the person is on**: a chip just pasted or picked with
 * `[` (the caret sits after it), a chip they clicked, or a link on words the
 * caret is in once its URL is known to name something. Shown only then: with
 * nothing to choose for, the button would be an action that cannot succeed.
 *
 * In the composer and in both edit boxes, beside the Highlight button and built
 * the way it is. Build first (Miky to Katerina, 5 Oct): the look is hers to
 * level up from here.
 */
import { IconLayoutBottombar } from '@tabler/icons-react'
import { useEditorState, type Editor } from '@tiptap/react'
import { Menu, MenuItem, MenuSection, ToolbarButton } from '@estiva-app/ui'
import type { EmbedLayout } from '@estiva-app/protocol'
import { cardOf, knownLinks, referenceAtSelection, setCard } from '@/extensions/cardChoices'

const LAYOUTS: { layout: EmbedLayout; label: string }[] = [
  { layout: 'none', label: 'None' },
  { layout: 'compact', label: 'Compact' },
  { layout: 'detailed', label: 'Detailed' },
]

export function CardButton({ editor }: { editor: Editor | null }) {
  const at = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed || ed.isDestroyed) return null
      const ref = referenceAtSelection(ed.state, knownLinks(ed))
      return ref ? { value: ref.value, card: cardOf(ed, ref.value) } : null
    },
  })
  if (!editor || !at) return null
  return (
    <Menu
      trigger={
        <ToolbarButton aria-label="Card" tooltip="Card under the message" data-card-control={at.card}>
          <IconLayoutBottombar size={16} stroke={1.5} />
        </ToolbarButton>
      }
      className="w-[180px]"
    >
      <MenuSection label="Card">
        {LAYOUTS.map(({ layout, label }) => (
          <MenuItem
            key={layout}
            label={label}
            selected={at.card === layout}
            onClick={() => {
              setCard(editor, at.value, layout)
              editor.commands.focus()
            }}
          />
        ))}
      </MenuSection>
    </Menu>
  )
}
