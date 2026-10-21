import type { ResolvedSlot } from '@estiva-app/interop'
import { linksAsReferences, referenceOfLink, referencesIn, toRenderTree, type RenderBlock } from '@estiva-app/protocol'
import { RichText } from '@estiva-app/ui'
import { useLinkResolver, useResolvedReferences } from '@/api'
import { referenceOfValue } from '@/lib/embedValue'
import { BlockLineCards, linksInBlocks } from './DocumentCards'
import { DocumentFile } from './DocumentFile'
import { Reference } from './Reference'

/**
 * Another app's `body` slot, rendered — PRO-2.
 *
 * The slot carries which content model it is written in (SPEC §13.4, resolved
 * by `@estiva-app/interop`), and §13 forbids reading either model as the other.
 * Passing it straight to `toRenderTree` is what makes that structural rather
 * than a rule to remember: the format is an argument, and a body is never
 * inspected to guess at one. §13.4's own case — a legacy description that
 * happens to begin with `{` is marker text, because it carries no tag — comes
 * out right without this file knowing it exists.
 *
 * **All three formats render.** This used to draw a block document as its raw
 * JSON, on the grounds that §13.5 permits declining to format and that a block
 * renderer would be a second implementation of §13.3. `toRenderTree` (RIC-6)
 * removed the trade: one resolution, and `unknown` still degrades to a single
 * unmarked paragraph, decided there rather than here so that no consumer gets
 * to guess.
 *
 * `format` still falls back to `marker` for a slot resolved by interop before
 * 0.8.0, which reported nothing for a body carried in a root tag. Nothing in
 * this repo can produce one — the dependency is `^0.8.0` — so it is a
 * belt-and-braces default rather than a live path.
 *
 * **Marks and chips, not Peek's tokens.** No `renderText`, so §13.1's marks and
 * links arrive and nothing else. Peek's own messages additionally resolve
 * `[Topic]` chips and mentions inside a run, and another app's body must not
 * get that layer: a Ship description's `[Title]` is not a topic in Peek.
 *
 * Peek's own bodies auto-linked `PEEK-`/`PR #` tokens too until 2026-09-03,
 * and the argument this comment made against extending that here is what
 * retired them everywhere: a description saying `PR #34` means a PR in the
 * repo it was written in, and a chip pointing it at `github.com/peek/peek`
 * is a wrong answer stated confidently.
 *
 * **A reference is its chip, and an app URL the chip of what it names**
 * (Widgets, Miky 14 Oct), as in the field a writer edits: this is the same
 * description for a reader who cannot write. The card its writer chose is
 * drawn after its line (SPEC §13.3) only with `cards`, which the object's own
 * page passes. A card draws this body too, and there every reference is its
 * chip and never a card: two objects that card each other would nest forever
 * (security review).
 */
export function ForeignBody({ slot, className, cards = false }: { slot: ResolvedSlot; className?: string; cards?: boolean }) {
  const tree = toRenderTree(slot.value, slot.format ?? 'marker')
  const links = linksInBlocks(tree)
  const lookup = useLinkResolver(links)
  const linked = links.flatMap((url) => {
    const value = lookup(url)
    const reference = value ? referenceOfValue(value) : undefined
    return reference ? [reference] : []
  })
  // Every chip's object in one read, the links' with the rest; a person's key is named by `Reference` itself.
  const resolved = useResolvedReferences([...new Set([...referencesIn(tree), ...linked])].filter((uri) => !/^nostr:npub1/i.test(uri)))
  // A link is its file's chip only once that file has come back and can be read: until then, and for good when it
  // cannot, the URL as written (OPT-18, as a message reads; WBM-11), never a chip with nothing in it.
  const resolveLink = (url: string) => {
    const value = lookup(url)
    const reference = value ? referenceOfValue(value) : undefined
    const object = reference ? resolved[reference] : undefined
    return object && !object.unreachable ? value : undefined
  }
  const blocks = linksAsReferences(tree, resolveLink)
  // One step down, with every heading, list, quote and table kept: it sits inside a card (Katerina, 28 September, UIG-30).
  return (
    <div data-foreign-body className={className}>
      <RichText
        blocks={blocks}
        size="small"
        // A link to one block opens at the block (WBM-11): the run keeps the URL as written. Only a run whose words are
        // that URL, resolved to this same file: a stored reference's words are its author's (security review).
        renderReference={(uri, run) => <Reference uri={uri} object={resolved[uri]} opensAt={referenceOfLink(run.text, resolveLink) === uri ? run.text : undefined} />}
        // A file in the text — a picture is one — as a part's and a message's are drawn (affd152a).
        renderBlock={(block) => (block.type === 'attachment' ? <DocumentFile attrs={block.attrs} /> : undefined)}
        // The package's block is the protocol's, handed back.
        renderAfter={cards ? (block) => <BlockLineCards block={block as RenderBlock} /> : undefined}
      />
    </div>
  )
}
