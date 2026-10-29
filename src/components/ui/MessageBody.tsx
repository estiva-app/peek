import type { FC, ReactNode } from 'react'
import { CommentAnchor } from './CommentAnchor'
import { MessageCard, MessageChip, MessagePart, MessageRow } from './MessageLinks'
import { placeLines, ROW_BLOCK, type RowLine } from '@/lib/messageLines'
import {
  IconFile,
  IconFileTypePdf,
  IconPhoto,
  IconTable,
  IconPresentation,
} from '@tabler/icons-react'
import { DOCUMENT_FILES } from '@/api'
import { INLINE_TOKEN_RE } from '@/lib/textParsing'
import { InlineChip, RichText } from '@estiva-app/ui'
import { linksIn, type ForeignObject } from '@estiva-app/interop'
import { PartCard } from './PartCard'
import { isWebLink } from '@/lib/referenceLink'
import { useLinkResolver, useResolvedReferences } from '@/api'
import { referenceOfValue, valueOfReference } from '@/lib/embedValue'
import {
  cardsIn,
  findNaddrs,
  linksAsReferences,
  pointerToAddress,
  referenceOfLink,
  referenceToPointer,
  referencesIn,
  toRenderTree,
  type Embed,
} from '@estiva-app/protocol'

/**
 * Peek's own words inside a run of plain text: `[Title]` chips and `@`/`!@`
 * mentions.
 *
 * Handed to the package's `RichText` as `renderText`, which calls it only with
 * text that is not code and not a link — it finds links itself first (UIG-30),
 * so an address is never read as a name, and `` `@Alice` `` in code stays text
 * (SPEC §13.1: code is never parsed for anything further).
 */
function renderTokens(text: string): ReactNode {
  const parts = text.split(INLINE_TOKEN_RE)
  if (parts.length === 1) return text
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('[') && part.endsWith(']') && part.length > 2) {
          const title = part.slice(1, -1)
          // A document. A `[Topic]` chip, matched against the topic list with
          // its resolved icon, went with the Convex topics (FOL-23). There used to be a second kind — an "app" file, which
          // was only ever Figma and carried its own SVG icon; it went with the
          // rest of that mock on 2026-09-11, and the <img> branch with it.
          const docFile = DOCUMENT_FILES.find((f) => f.title === title)
          const tablerIcons: Record<string, FC<{ size: number; stroke: number; className?: string }>> = {
            pdf: IconFileTypePdf, image: IconPhoto,
            spreadsheet: IconTable, presentation: IconPresentation,
          }
          const TablerIcon = tablerIcons[docFile?.docType ?? ''] ?? IconFile
          return (
            <InlineChip key={i} icon={<TablerIcon size={14} stroke={1.5} />}>
              <span>{title}</span>
            </InlineChip>
          )
        }
        if (/^(?:!@|@)/.test(part) && part.length > 1) {
          // Same treatment the composer gives the tag while typing: urgent
          // mentions wear the warning colors, plain mentions the accent.
          const urgent = part.startsWith('!@')
          return (
            <InlineChip key={i} tone={urgent ? 'urgent' : 'person'}>
              {part}
            </InlineChip>
          )
        }
        return part ? <span key={i}>{part}</span> : null
      })}
    </>
  )
}



/**
 * One entry per referenced object, whichever notation it arrived in.
 *
 * `naddr1…` and `<kind>:<pubkey>:<d>` are two spellings of one address, so the
 * address is the identity. A string that parses as neither is kept as-is rather
 * than dropped: the widget renders nothing for it, which is the same outcome,
 * and silently discarding references here would hide the reason.
 */
/** At most this many blocks are drawn live in one message (SPEC §13.6.1); the rest stay links. */
const MAX_PARTS_PER_MESSAGE = 6

/** At most this many of a message's links are asked what they name (§7.7) — Ship's `MAX_LINKS_PER_MESSAGE`. */
const MAX_LINKS_PER_MESSAGE = 8

const FOLLOW = { live: true }

/**
 * Whether a pasted app link names this address: its path ends in the address's
 * `d` (§7.2 puts the identity last, `…/<slug>-<d>`), and that `d` is long enough
 * to be one. A `d` comes from somebody's tag, so a short one would otherwise
 * match half the links in the body.
 */
function urlNames(url: string, address: string): boolean {
  const d = address.split(':')[2] ?? ''
  if (d.length < 8) return false
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '')
  return path.endsWith(`-${d}`) || path.endsWith(`/${d}`)
}

function addressOf(ref: string): string {
  try {
    return pointerToAddress(referenceToPointer(ref))
  } catch {
    return ref
  }
}

function dedupeReferences(refs: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const ref of refs) {
    const key = addressOf(ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

/**
 * The text of a message or reply, formatted, with its mentions and links, each
 * item from another app it names drawn as its chip, and below it the cards its
 * author chose.
 */
export function MessageBody({ body, nostrReferences, nostrBlockId, resolvedObjects, urgentMentions, parts, embeds, authorName, follow = true, here, preview = false, onRemoveCard }: { body: string; /** The author's ✕ on a card under it, by its value; shown on hover. Omitted, no ✕. */ onRemoveCard?: (value: string) => void; /** The address of the file this message is shown on ("Mentioned in", a file's conversation): no card for it, its chip stays (WID-3). */ here?: string; /** A preview of the message (the Screener's): its links as chips only — no row, no card, no part (Decided 16 Oct). */ preview?: boolean; nostrReferences?: string[]; nostrBlockId?: string; resolvedObjects?: Record<string, ForeignObject>; /** The event's urgent keys (SPEC §13.1, CON-24). */ urgentMentions?: readonly string[]; /** The event's `part` tags (SPEC §13.6.1, COM-2), and a comment's own anchor flagged `anchor`, with its `block` and `quote` tags (LEAF-7). */ parts?: readonly { address: string; block: string; anchor?: true; anchorTags?: string[][] }[]; /** Who wrote it, for a quote its anchor no longer finds. */ authorName?: string; /** The cards its author asked for, after edits (SPEC §13.6.2). */ embeds?: readonly Embed[]; /** Chips follow their files' changes while shown — a conversation's; off for a list of previews, where each Folder named would cost a watch. */ follow?: boolean }) {
  /*
    What the message is about, for its anchor's card: its `a` tags (sync stores
    them in `nostrReferences`) and the addresses its body names, deduplicated by
    address because the two spell them differently (FEE-2). An `a` is an index,
    not a card (§6.4): nothing is drawn for one on its own (OPT-18).
  */
  const references = dedupeReferences([...(nostrReferences ?? []), ...findNaddrs(body)])
  /*
    A block of another object, shown live (SPEC §13.6.1, COM-2) — only while the
    body still names that object, because an edit carries no `part` and a person
    who took the link out meant the card to go with it. The body names it by a
    `nostr:naddr…` or by a pasted app link, whose path ends in the object's `d`.
  */
  const tree = body ? toRenderTree(body, 'marker') : []
  // Web links only: a `mailto:` names nothing, and must not use up `MAX_LINKS_PER_MESSAGE` below.
  const urls = linksIn(tree).filter(isWebLink)
  const named = new Set(findNaddrs(body).map(addressOf))
  // A comment's anchor (§13.6) is what it is about, not something it names, so
  // it is drawn above the text whatever the body says — with the same card.
  const anchored = (parts ?? []).filter((part) => part.anchor)
  const shown = (parts ?? [])
    .filter(({ address, anchor }) => {
      if (anchor) return false
      return named.has(address) || urls.some((url) => urlNames(url, address))
    })
    // Each card reads the relay on its own schedule; a message is a remark, not
    // a dashboard, and one with dozens of links would spend every viewer's quota.
    .slice(0, MAX_PARTS_PER_MESSAGE)
  /*
    What each app link names (§7.7), as answers come back — the message draws
    again with each. Only a link's target or a bare URL is asked about, and
    none in code (`linksIn`, the links a send tags): a URL written in a link's
    *label* would otherwise name an object the link does not open (OPT-17's
    security review). A link to one block names its file, so it is
    that file's chip, the block live under the message (WBM-11). At most
    `MAX_LINKS_PER_MESSAGE`, the first ones, as Ship asks: each claimed link is
    a relay query (OPT-18's security review). The rest stay links.
  */
  const asked = urls.slice(0, MAX_LINKS_PER_MESSAGE)
  const lookup = useLinkResolver(asked)
  const claimed = (url: string) => (asked.includes(url) ? lookup(url) : undefined)
  /*
    What the caller already has, if anything. `resolvedObjects` is the seam for
    a surface with no relay to ask — a story, a test — and the widget below
    honours it already. Honouring it here too is not a convenience: without it
    one screen would show the card resolved and the chip beside it unresolved,
    for the same object.

    Looked up with and without the scheme, because the two lists spell it
    differently: `findNaddrs` returns a bare `naddr1…` and a `reference` run
    carries the `nostr:` URI it was written as.
  */
  const supplied = (ref: string) =>
    resolvedObjects?.[ref] ?? resolvedObjects?.[ref.replace(/^nostr:/, '')]
  /*
    Only what a widget could be drawn for: the references the body wrote, and
    what each claimed link names. A person resolves synchronously from the
    directory, so asking the relay about an `npub` would be a round trip with
    nothing at the end of it.
  */
  const linked = asked.flatMap((url) => {
    const value = claimed(url)
    const reference = value ? referenceOfValue(value) : undefined
    return reference ? [reference] : []
  })
  const fetched = useResolvedReferences(
    [...new Set([...referencesIn(tree), ...linked])].filter((ref) => !/^nostr:npub1/i.test(ref) && !supplied(ref)),
    // A chip draws its file's title and status, so it follows them while shown, as a widget does.
    follow ? FOLLOW : undefined,
  )
  const resolved: Record<string, ForeignObject | null> = { ...fetched }
  const reachable = (ref: string) => {
    const object = supplied(ref) ?? resolved[ref]
    return !!object && !object.unreachable
  }
  /*
    Every reference is drawn where it was written, as its chip — alone on its
    line too (OPT-18; Katerina, 5 Oct). A bare app link is a reference written
    as a URL, so it reads as one: the package turns each it can name into a
    reference run, by the rule Ship uses, so one body reads the same in both
    (§13.5). Only once what it names has come back and can be read: until then,
    and for good when it cannot, it stays the link it was written as, rather
    than a chip with nothing in it. A link on words stays a link.
  */
  const resolveLink = (url: string) => {
    const value = claimed(url)
    const reference = value ? referenceOfValue(value) : undefined
    return reference && reachable(reference) ? value : undefined
  }
  const blocks = linksAsReferences(tree, resolveLink)
  /*
    The cards its author asked for (SPEC §13.6.2) — the only cards a message
    draws. The package's rule, `cardsIn`, asked as Ship's `cardsOf` asks it, so
    the two apps draw the same message the same way: the layout they chose, or
    nothing for `none`. Each is keyed by the reference the body wrote, which is
    what resolves; a link's card by the reference its value spells.
  */
  const written = new Map<string, string>()
  for (const reference of embeds?.length ? referencesIn(blocks) : []) {
    const value = valueOfReference(reference)
    if (value && !written.has(value)) written.set(value, reference)
  }
  // The first URL the body wrote for each card's file: the card opens it, as that file's chip would (LTX-6).
  // Only a URL that itself names that file, as a chip checks (LTX-6 security review).
  const writtenUrl = new Map<string, string>()
  const urlsIn = (bs: readonly (typeof blocks)[number][]) => {
    for (const block of bs) {
      for (const run of block.inline ?? []) {
        const value = run.reference && /^https?:\/\//i.test(run.text) && referenceOfLink(run.text, resolveLink) === run.reference ? valueOfReference(run.reference) : undefined
        if (value && !writtenUrl.has(value)) writtenUrl.set(value, run.text)
      }
      if (block.children) urlsIn(block.children)
    }
  }
  if (embeds?.length) urlsIn(blocks)
  const cards = embeds?.length
    ? cardsIn(embeds, blocks, shown, claimed).flatMap((card) => {
        const reference = written.get(card.value) ?? referenceOfValue(card.value)
        return reference ? [{ ...card, reference }] : []
      })
    : []
  for (const ref of referencesIn(blocks)) {
    const known = supplied(ref)
    if (known) resolved[ref] = known
  }
  /*
    Where each line draws (SPEC §13.2; why:
    https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md):
    a link in a sentence is its chip, a line that is only a link to a file or a
    message is that file's row, and the file whose card is under the message
    draws nothing in the text, since the card stands for it. A preview draws
    chips only (Decided 16 Oct), and the file a "Mentioned in" list is on keeps
    its chip where it was written, with no card (WID-3).
  */
  const isHere = (value: string) => !!here && value.toLowerCase() === here.toLowerCase()
  const drawnCards = preview ? [] : cards.filter((card) => !isHere(card.value))
  const placed = preview ? undefined : placeLines(blocks, { cards: drawnCards, parts: shown, resolveLink, stayChip: isHere })
  // A link to one block opens at the block (`opensAt`, the URL as written); any other where its file opens.
  const chip = (reference: string, written?: string) => <MessageChip uri={reference} object={resolved[reference]} urgent={urgentMentions} preview={!preview} opensAt={written} />
  const row = (line: RowLine) => <MessageRow uri={line.reference} object={resolved[line.reference]} unreadable={line.unreadable} opensAt={line.url} />
  return (
    <div data-message-body className="flex flex-col gap-1 text-body-2 text-text-secondary break-words">
      {/* Which part of the referenced object this is about (SPEC §13.6).
          Above the text, because it is the subject of the remark rather than
          part of it — the same reason a quoted line goes above a reply. */}
      {!preview &&
        (anchored.length > 0
          ? anchored.map((part) => (
              <MessagePart key={part.address}>
                <PartCard address={part.address} block={part.block} anchorTags={part.anchorTags} quotedBy={authorName} />
              </MessagePart>
            ))
          : <CommentAnchor blockId={nostrBlockId} object={resolvedObjects?.[references[0]]} />)}
      <RichText
        blocks={placed?.blocks ?? blocks}
        renderText={renderTokens}
        renderReference={(reference, run) => {
          const line = placed?.rowRuns.get(run)
          return line ? row(line) : chip(reference, run.text)
        }}
        renderBlock={(block) => {
          const line = block.type === ROW_BLOCK ? placed?.rowOf(block) : undefined
          return line ? row(line) : undefined
        }}
      />
      {drawnCards
        .filter((card) => card.layout !== 'none')
        .map((card) => (
          <MessageCard
            key={card.value}
            uri={card.reference}
            resolved={supplied(card.reference)}
            compact={card.layout !== 'detailed'}
            onRemove={onRemoveCard && card.layout === 'detailed' ? () => onRemoveCard(card.value) : undefined}
            opensAt={writtenUrl.get(card.value)}
          />
        ))}
      {!preview &&
        shown.map((part) => (
          <MessagePart key={part.address}>
            <PartCard address={part.address} block={part.block} />
          </MessagePart>
        ))}
    </div>
  )
}
