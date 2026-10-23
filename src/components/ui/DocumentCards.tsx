/**
 * A lone link's line in another app's description, as Peek's side panel draws
 * it (SPEC §13.3, "A reference's card"; Widgets, Miky 14 Oct: Peek's panel
 * draws what its writer chose, as Ship does).
 *
 * The choice is the chip's own `embed`, so it moves and goes with the chip —
 * unlike a message's, which travels beside the text (`boxLinksOf`,
 * @estiva-app/conversation). A link alone on its line is the file's row, and
 * `detailed` its card in the row's place (`placeLines`' `document`, protocol
 * `documentLineDrawOf`): the same row and card as under a message
 * (`MessageRow`, `MessageCard`; Miky, 23 Oct: one link, one card in every
 * app). The card changes only what the file's app shares, a status or an
 * owner, never its words, parent or archive. The card's own body draws its
 * references as chips, never cards (`ForeignBody`).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-card-changes-what-a-files-app-shares.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-lone-links-chip-menu-offers-row-or-card.md
 */
import type { ForeignObject } from '@estiva-app/interop'
import { urlRunsIn, type RenderBlock } from '@estiva-app/protocol'
import type { RowLine } from '@/lib/messageLines'
import { MessageCard, MessageRow } from './MessageLinks'

/** A description's line that is only a link: its row, or the card its writer chose in the row's place. */
export function DocumentLine({ line, object }: { line: RowLine; object: ForeignObject | null | undefined }) {
  return line.card
    ? <MessageCard uri={line.reference} resolved={object ?? undefined} opensAt={line.url} />
    : <MessageRow uri={line.reference} object={object} unreadable={line.unreadable} opensAt={line.url} />
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
