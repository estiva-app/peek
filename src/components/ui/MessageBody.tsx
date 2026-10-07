import type { FC, ReactNode } from 'react'
import { Reference } from './Reference'
import { CommentAnchor } from './CommentAnchor'
import {
  IconFile,
  IconFileTypePdf,
  IconPhoto,
  IconTable,
  IconPresentation,
} from '@tabler/icons-react'
import { DOCUMENT_FILES } from '@/api'
import { INLINE_TOKEN_RE, findUrls } from '@/lib/textParsing'
import { InlineChip, RichText } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import { ForeignObjectWidget } from './ForeignObjectWidget'
import { useResolvedReferences } from '@/api'
import {
  findNaddrs,
  pointerToAddress,
  referenceToPointer,
  referencesIn,
  standaloneReference,
  toRenderTree,
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
 * The text of a message or reply, formatted, with its mentions and links, and a
 * card below for each item from another app it mentions.
 */
export function MessageBody({ body, nostrReferences, nostrBlockId, resolvedObjects, urgentMentions }: { body: string; nostrReferences?: string[]; nostrBlockId?: string; resolvedObjects?: Record<string, ForeignObject>; /** The event's urgent keys (SPEC §13.1, CON-24). */ urgentMentions?: readonly string[] }) {
  // NIP-27: a `nostr:naddr…` anywhere in the body refers to another app's
  // object. Rendered as a block BELOW the text rather than inline, because a
  // widget is not a word.
  // 
  /**
   * Both sources, merged — not one *or* the other.
   *
   * An imported message carries its references as `a` tags, which sync stores
   * in `nostrReferences`; a message composed here has them only in its body.
   * Preferring the stored list meant that the moment a message came back from
   * the relay, its perfectly good `naddr` in the body stopped being read at all
   * (FEE-2). One list shadowing the other is fragile in a way that merging is
   * not: an entry that cannot be resolved now costs one missing widget rather
   * than every widget on the message.
   *
   * Deduplicated by address, because the two sources describe the same objects
   * in different notations and would otherwise render each one twice.
   */
  const references = dedupeReferences([...(nostrReferences ?? []), ...findNaddrs(body)])

  /**
   * Where the pointer was written decides how it is drawn — RIC-10.
   *
   * PEEK-18 cut every `naddr` out of the prose with `stripNaddrs`, on the
   * grounds that the widget below already says what the reference is and says
   * it in words. That was the honest thing to build when a message had no
   * structure to put a widget into, and it is still right for a pointer sitting
   * alone on its own line.
   *
   * It was never right for one written *inside a sentence*, which lost its
   * place in the sentence — Miky, 2026-09-02: *"Imagine mentioning project in
   * your message in the middle of sentence that shows the name."* So the two
   * cases are told apart instead of being flattened into one.
   *
   * `standaloneReference` lives in `@estiva-app/protocol` rather than here, so
   * Ship reaches the same answer for the same body. The two apps disagreeing
   * about which pointers survive the prose is exactly the class of thing
   * §13.5's shared render tree exists to rule out — and RIC-10's done-when asks
   * for the same body to render the same way in both.
   */
  const blocks = body ? toRenderTree(body, 'marker') : []
  const standalone = blocks.map(standaloneReference).filter((ref): ref is string => !!ref)
  const inline = referencesIn(blocks).filter((ref) => !standalone.includes(ref))
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
    Only what is left, and only what a widget could be drawn for. A person
    resolves synchronously from the directory, so asking the relay about an
    `npub` would be a round trip with nothing at the end of it.
  */
  const fetched = useResolvedReferences(
    inline.filter((ref) => !/^nostr:npub1/i.test(ref) && !supplied(ref)),
  )
  const resolved: Record<string, ForeignObject | null> = { ...fetched }
  for (const ref of inline) {
    const known = supplied(ref)
    if (known) resolved[ref] = known
  }
  /*
    Drawn in place, so not drawn again below. A message composed here puts the
    pointer in the body *and* publishes an `a` tag for it, so without this the
    same object would appear twice — once mid-sentence and once as a card, the
    second one arriving on its own schedule. Compared by address, because the
    two sources spell it differently (see `dedupeReferences`).
  */
  const drawnInline = new Set(inline.map(addressOf))
  /*
    A message alone on its line is attached, the way an object alone on its
    line is (RIC-11). `references` only ever held addresses — `a` tags and
    `findNaddrs` — so a paragraph that was nothing but a `nostr:nevent…` was
    hidden from the prose above and then drawn by nothing below, and the
    message it mentioned simply vanished. Same test as for an `naddr`,
    `standaloneReference`, so the two apps keep agreeing about which is which.
    Spelled bare, as `findNaddrs` spells its answers, so one list has one form.
  */
  const attachedEvents = standalone
    .filter((ref) => /^nostr:(?:nevent|note)1/i.test(ref))
    .map((ref) => ref.replace(/^nostr:/i, ''))
  const attachments = [...references.filter((ref) => !drawnInline.has(addressOf(ref))), ...attachedEvents]
  // A message that was *only* a reference has no blocks left to lay out, and
  // `RichText` draws nothing rather than an empty paragraph that still takes a
  // gap.
  return (
    <div data-message-body className="flex flex-col gap-1 text-body-2 text-text-secondary break-words">
      {/* Which part of the referenced object this is about (SPEC §13.6).
          Above the text, because it is the subject of the remark rather than
          part of it — the same reason a quoted line goes above a reply. */}
      <CommentAnchor blockId={nostrBlockId} object={resolvedObjects?.[references[0]]} />
      {/* A block that is nothing but a reference is drawn below as a card, so it leaves the text. */}
      <RichText
        blocks={blocks.filter((block) => !standaloneReference(block))}
        renderText={renderTokens}
        renderReference={(reference) => <Reference uri={reference} object={resolved[reference]} urgent={urgentMentions} />}
      />
      {attachments.map((naddr) => (
        <ForeignObjectWidget key={naddr} naddr={naddr} resolved={supplied(naddr)} />
      ))}
      {/*
        A pasted app URL, rendered as the object it names — RFC 0.5 §7.5,
        PRO-15. The link stays in the prose: unlike an `naddr`, which PEEK-18
        strips because the widget says it in words, a URL is something a person
        deliberately wrote and may want to click.

        `quiet` because most links are only links. One that no manifest claims
        resolves to null and draws nothing, and drawing a skeleton under every
        ordinary link meanwhile would be worse than the gap it fills.
      */}
      {findUrls(body).map((url) => (
        <ForeignObjectWidget key={url} naddr={url} resolved={resolvedObjects?.[url]} quiet />
      ))}
    </div>
  )
}
