/**
 * What the message box shows under itself, as it will be sent (SPEC §13.6.1,
 * §13.6.2; why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md).
 *
 * - **One file's card.** When what is written names exactly one file, its
 *   default card, `["embed", V, "detailed"]`, by protocol's `defaultCardOf`:
 *   a Folder, a person, a message and the file the conversation is on do not
 *   count, a link on words counts by its target, and a plain web link counts
 *   for nothing. ✕ takes it off (the box's to keep).
 * - **The live part of each block link**, as the `part` the message will
 *   carry, one per file. A part counts as its file and draws instead of a card,
 *   so linking an issue and a block of a page shows the block and no card.
 *
 * Read from the text the box would send (`serializeTiptapToText`), by the rules
 * a reader draws it by, so what shows under the box is what shows under the
 * message.
 */
import { defaultCardOf, toRenderTree, valuesIn, withCard, type Embed, type LinkResolver, type PartPointer } from '@estiva-app/protocol'
import { findUrls } from './textParsing'

/** At most this many blocks show live under one message (SPEC §13.6.1); `MessageBody` draws no more. */
const MAX_PARTS = 6

export interface BoxLinks {
  /** Every address and event id the text names. */
  values: string[]
  /** The block links' parts, one per file, the first link's. */
  parts: PartPointer[]
  /** The file that gets the default card, before any ✕. */
  card?: string
}

export interface BoxLinkContext {
  /** What an app link names for a card (§7.7), as answered so far. */
  resolveLink: LinkResolver
  /** The file and block a link to one block names, as answered so far. */
  blockOf: (url: string) => PartPointer | undefined
  /** The file whose conversation this is: it gets no card here. */
  here?: string
  /** An edit's: the values the message named before it, which get no default again. */
  previous?: readonly string[]
}

/**
 * What an app link in the message box draws as: the file or message it names,
 * or, for a link to one block, its file (§13.6.1), so a pasted block link
 * reads as its file's chip, the block live under the box (Decided 16 Oct).
 */
export function linkTargetOf(url: string, context: Pick<BoxLinkContext, 'resolveLink' | 'blockOf'>): string | undefined {
  return context.resolveLink(url) ?? context.blockOf(url)?.address
}

/** The block links in a text, one per file, the first link's. */
function partsIn(text: string, blockOf: BoxLinkContext['blockOf']): PartPointer[] {
  const parts = new Map<string, PartPointer>()
  for (const url of findUrls(text)) {
    const part = blockOf(url)
    if (part && !parts.has(part.address)) parts.set(part.address, part)
  }
  return [...parts.values()].slice(0, MAX_PARTS)
}

/** What a text names, and the one file it gives the default card. */
export function boxLinksOf(text: string, context: BoxLinkContext): BoxLinks {
  const values = valuesIn(text ? toRenderTree(text, 'marker') : [], context.resolveLink)
  const parts = partsIn(text, context.blockOf)
  const card = defaultCardOf(values, parts, { here: context.here, previous: context.previous })
  return { values, parts, card }
}

/**
 * What a message named before an edit, for `defaultCardOf`'s `previous`: its
 * values, and the file of each block link, which was named too.
 */
export function namedBefore(text: string, context: Pick<BoxLinkContext, 'resolveLink' | 'blockOf'>): string[] {
  const { values, parts } = boxLinksOf(text, context)
  return [...new Set([...values, ...parts.map((part) => part.address)])]
}

/** The `embed` set a new message sends: the default card, unless ✕ took it off. `none` is never written. */
export function embedsToSend(links: BoxLinks, removed: ReadonlySet<string>): Embed[] {
  return links.card && !removed.has(links.card) ? [{ value: links.card, layout: 'detailed' }] : []
}

/**
 * The `embed` set an edit sends, or undefined to leave the message's as it
 * was. Only an edit that names a file first adds its default (`links` read
 * with `previous`), and then it carries the whole folded set with it, since a
 * set replaces (§13.6.2). A card removed with ✕, before sending or after,
 * stays removed.
 */
export function embedsToEdit(links: BoxLinks, removed: ReadonlySet<string>, folded: readonly Embed[] | undefined): Embed[] | undefined {
  return links.card && !removed.has(links.card) ? withCard(folded ?? [], links.card, 'detailed') : undefined
}

/** ✕ on a sent message's card: the folded set, with that card `none` and every other kept. */
export function withoutCard(folded: readonly Embed[] | undefined, value: string): Embed[] {
  return withCard(folded ?? [], value, 'none')
}
