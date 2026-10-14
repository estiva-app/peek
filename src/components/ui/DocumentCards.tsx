/**
 * A chip in another app's description, and the card its writer chose after
 * its line (SPEC §13.3, "A reference's card"; Widgets, Miky 14 Oct: Peek's
 * panel draws the chosen card and offers the choice, as Ship does).
 *
 * The choice is the chip's own `embed`, so it moves and goes with the chip —
 * unlike a message's, which travels beside the text (`cardChoices`). Compact is
 * the object's row and detailed its card, as under a message, and the card's
 * own body draws its references as chips, never cards (`ForeignBody`).
 */
import { createPortal } from 'react-dom'
import { useEditorState, type Editor } from '@tiptap/react'
import { IconCircleOff, IconLayoutCards, IconLayoutList } from '@tabler/icons-react'
import { blockCards, urlRunsIn, type RenderBlock } from '@estiva-app/protocol'
import { ToolbarButton } from '@estiva-app/ui'
import {
  referenceAtSelection,
  setReferenceCard,
  useReferenceCards,
  type ReferenceCard,
  type ReferenceCardLayout,
  type ReferenceViewProps,
} from '@estiva-app/ui/editor'
import { useResolvedReferences } from '@/api'
import { ForeignObjectWidget } from './ForeignObjectWidget'
import { Reference } from './Reference'

/** A reference in the field, as its chip. A person's key is named by `Reference` itself. */
export function DocumentReference({ uri }: ReferenceViewProps) {
  const person = /^nostr:npub1/i.test(uri)
  const resolved = useResolvedReferences(person ? [] : [uri])
  return <Reference uri={uri} object={resolved[uri]} />
}

function LineCards({ cards }: { cards: readonly ReferenceCard[] }) {
  return (
    <div className="mt-2 flex flex-col gap-2" data-line-cards={cards.length}>
      {cards.map((card, i) => (
        <div key={`${card.uri}-${i}`} data-card={card.layout}>
          <ForeignObjectWidget naddr={card.uri.replace(/^nostr:/i, '')} layout={card.layout === 'detailed' ? 'card' : 'row'} />
        </div>
      ))}
    </div>
  )
}

/** A read description's cards for one block, for `RichText`'s `renderAfter` (`ForeignBody`). */
export function BlockLineCards({ block }: { block: RenderBlock }) {
  const cards = blockCards(block).map((card) => ({ uri: card.reference, layout: card.layout }))
  return cards.length ? <LineCards cards={cards} /> : null
}

/** How many of a description's URLs are asked what they name — the editor's `LinkChips` limit, and Ship's. */
export const MAX_LINKS_PER_DESCRIPTION = 24

/**
 * The URLs a description holds — in its text, and on a link that carries a
 * card — for `useLinkResolver` to ask what each names (§7.7, Widgets). At most
 * `MAX_LINKS_PER_DESCRIPTION`, the first ones, as a message's are capped: a
 * claimed link is a relay query for every viewer. The rest stay links.
 */
export function linksInBlocks(blocks: readonly RenderBlock[]): string[] {
  const out = new Set<string>()
  const walk = (bs: readonly RenderBlock[]) => {
    for (const block of bs) {
      if (block.type === 'codeBlock') continue
      for (const run of block.inline ?? []) {
        if (run.href) out.add(run.href)
        else if (!run.reference && !run.marks.includes('code')) for (const { url } of urlRunsIn(run.text)) out.add(url)
      }
      if (block.children) walk(block.children)
    }
  }
  walk(blocks)
  return [...out].slice(0, MAX_LINKS_PER_DESCRIPTION)
}

/** The field's cards, each drawn into the slot after its line. */
export function DocumentLineCards({ editor }: { editor: Editor | null }) {
  const slots = useReferenceCards(editor)
  // @estiva-escape(no-rebuilt-behaviour): each card goes into the slot ReferenceCards placed after its line, inside the editor's text; no part owns a place there, and a portal keeps Peek's providers around the card
  return <>{slots.map((slot) => createPortal(<LineCards cards={slot.cards} />, slot.element, slot.key))}</>
}

const CHOICES: { layout: ReferenceCardLayout; label: string; Icon: typeof IconCircleOff }[] = [
  { layout: 'none', label: 'No card', Icon: IconCircleOff },
  { layout: 'compact', label: 'Compact card', Icon: IconLayoutList },
  { layout: 'detailed', label: 'Detailed card', Icon: IconLayoutCards },
]

/**
 * None, compact or detailed for the selected chip, in the field's selection
 * toolbar. Shown only while one chip is selected. Build first; the look is
 * Katerina's to level up (Miky, 5 Oct).
 */
export function DocumentCardChoice({ editor }: { editor: Editor | null }) {
  const at = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed || ed.isDestroyed) return null
      return referenceAtSelection(ed.state)?.layout ?? null
    },
  })
  if (!editor || !at) return null
  return (
    <>
      {CHOICES.map(({ layout, label, Icon }) => (
        <ToolbarButton
          key={layout}
          aria-label={label}
          tooltip={label}
          pressed={at === layout}
          data-card-choice={layout}
          // Keep the selection: focus must not leave the editor on press.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setReferenceCard(editor, layout)}
        >
          <Icon size={16} stroke={1.5} />
        </ToolbarButton>
      ))}
    </>
  )
}
