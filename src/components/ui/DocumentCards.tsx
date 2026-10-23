/**
 * The card its writer chose after a chip's line in another app's description
 * (SPEC §13.3, "A reference's card"; Widgets, Miky 14 Oct: Peek's panel draws
 * the chosen card, as Ship does).
 *
 * The choice is the chip's own `embed`, so it moves and goes with the chip —
 * unlike a message's, which travels beside the text (`boxLinksOf`,
 * @estiva-app/conversation). Compact is the file's row and detailed its card,
 * the same row and card as under a message (`MessageCard`; Miky, 23 Oct: one
 * link, one card in every app): it changes only what the file's app shares, a
 * status or an owner, never its words, parent or archive. The card's own body
 * draws its references as chips, never cards (`ForeignBody`).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-card-changes-what-a-files-app-shares.md
 */
import { blockCards, urlRunsIn, type RenderBlock } from '@estiva-app/protocol'
import { MessageCard } from './MessageLinks'

function LineCards({ cards }: { cards: readonly { uri: string; layout: 'compact' | 'detailed' }[] }) {
  return (
    <div className="mt-2 flex flex-col gap-2" data-line-cards={cards.length}>
      {cards.map((card, i) => (
        <MessageCard key={`${card.uri}-${i}`} uri={card.uri} compact={card.layout === 'compact'} />
      ))}
    </div>
  )
}

/** A read description's cards for one block, for `RichText`'s `renderAfter` (`ForeignBody`). */
export function BlockLineCards({ block }: { block: RenderBlock }) {
  const cards = blockCards(block).map((card) => ({ uri: card.reference, layout: card.layout }))
  return cards.length ? <LineCards cards={cards} /> : null
}

/** How many of a description's URLs are asked what they name — the shared editor's `LinkChips` limit, and Ship's. */
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
        // A link on words never becomes a chip, so it spends none of the budget.
        if (run.href) {
          if (run.text === run.href) out.add(run.href)
        }
        else if (!run.reference && !run.marks.includes('code')) for (const { url } of urlRunsIn(run.text)) out.add(url)
      }
      if (block.children) walk(block.children)
    }
  }
  walk(blocks)
  return [...out].slice(0, MAX_LINKS_PER_DESCRIPTION)
}
