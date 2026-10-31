import { serializeBlockDocument, toRenderTree, type Quote } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { PartCard as KitPartCard, RichText, thingKindOf } from '@estiva-app/ui'
import { usePart, type PartView } from '@/api'
import { objectLabel, openInAppUrl } from '@/lib/appName'
import { blobObjectUrl } from '@/nostr/media'
import { DocumentFile } from './DocumentFile'

/**
 * Past this height a block is cut behind ShowMore's fade, and opens in place.
 * The package's default is 96px; 160px is the cut this card had before it took
 * ShowMore (about six table rows), so a short table is still drawn whole.
 */
const CUT_AT = 160

/**
 * One block of another object, live inside a message — SPEC §13.6.1, COM-2.
 * This one reads it (`usePart`); `PartCardView` draws what the read gave.
 *
 * @registry namesake: reads the part from the relay and draws its blocks inside the package's PartCard, which draws only the frame.
 */
export function PartCard({ address, block, anchorTags, quotedBy }: { address: string; block: string; /** A comment's `block` and `quote` tags, when this is its anchor (§13.6). */ anchorTags?: string[][]; /** Who wrote the comment, for its quote once the words have changed. */ quotedBy?: string }) {
  return <PartCardView view={usePart({ address, block, anchorTags })} address={address} block={block} quotedBy={quotedBy} />
}

/**
 * One block of another object, drawn from a read that has already happened.
 *
 * Drawn the way an attachment is (Miky, kickoff 2026-10-07): the object's type
 * and title, then the block — whole when it is short; cut behind ShowMore's fade
 * when it is long, and opened in place (Katerina, 2026-10-08). The way into the
 * app it came from is its title; there is no "Open in" button beside it, which
 * said again what the title does (Katerina, 31 Oct).
 *
 * **Five states, in the kit's words** (SPEC §13.6.1; ui 0.92): the file
 * deleted says so ("A part of this issue deleted"), and one the reader may not
 * see says only "not available", with no title and no text, which would tell
 * them something about a Folder they are not in. A file still there whose part
 * was deleted is "This part was deleted"; one whose part can't be addressed is
 * "This part can't be shown", linking to the whole file.
 */
export function PartCardView({
  view,
  address,
  block,
  fetchImage = blobObjectUrl,
  quotedBy,
}: {
  view: PartView
  address: string
  block: string
  /** Who quoted the words a `reworded` anchor no longer finds. */
  quotedBy?: string
  /** How a picture in the block is fetched: Peek's authenticated fetch, unless a story hands it a picture it already has. */
  fetchImage?: (mediaUrl: string) => Promise<string>
}) {
  // What it is part of, by its icon, known from the address before anything is read.
  const kind = thingKindOf(Number(address.split(':')[0]))
  if (view.state === 'loading') {
    return (
      <div data-part="loading" data-part-address={address} className="mt-1">
        <KitPartCard state="loading" kind={kind} />
      </div>
    )
  }

  /*
    Not this reader's to see, or deleted by a deletion the protocol trusts
    (`readAbsence`): neither draws a title or its words, which would tell a
    reader something about a Folder they are not in.
  */
  if (view.state === 'unreadable' || view.state === 'deleted') {
    return (
      <div data-part={view.state} data-part-address={address} className="mt-1">
        <KitPartCard state={view.state === 'deleted' ? 'deleted' : 'unavailable'} kind={kind} noun={kind[0].toUpperCase() + kind.slice(1)} />
      </div>
    )
  }

  // The file is there and its part is not, or can't be one: the kit's words; "can't be shown" opens the whole file.
  if (view.state !== 'resolved' && view.state !== 'reworded') {
    return (
      <div data-part={view.state} data-part-address={address} className="mt-1">
        <KitPartCard state={view.state} kind={thingKindOf(view.object.kind)} href={openInAppUrl(view.object)} />
      </div>
    )
  }

  // The way into the app it came from is a manifest's URL: http(s) only, as every other link to another app.
  const frame = { kind: thingKindOf(view.object.kind), heading: headingOf(view.object), href: openInAppUrl({ openUrl: view.link }) }

  const run = view.run ?? [view.block]
  const blocks = toRenderTree(serializeBlockDocument({ type: 'doc', content: run }), 'blocks')
  const content = <RichText blocks={blocks} size="small" renderBlock={(b) => (b.type === 'attachment' ? <DocumentFile attrs={b.attrs} fetchImage={fetchImage} /> : undefined)} />
  return (
    <div data-part={view.state} data-part-address={address} data-part-block={block} className="mt-1">
      {/* An attachment is never cut (no height reaches Infinity): its card is
          already the thumbnail, and a click on it opens the full picture as it
          does on a message's own. */}
      <KitPartCard {...frame} maxHeight={run.length === 1 && view.block.type === 'attachment' ? Infinity : CUT_AT}>
        {content}
        {/* The words a comment quoted, once they are no longer in its blocks
            (§13.6 `reworded`): said as what the commenter quoted, never as what
            the page said, since the relay does not check a quote (Miky, LEAF-7
            /land). The look is Katerina's to set. */}
        {view.state === 'reworded' && (
          <span data-part-quote className="line-clamp-2 text-caption italic text-text-muted">
            {quotedBy ? `${quotedBy} quoted` : 'Quoted'}: “{quoteText(view.quote)}” · No longer in the text
          </span>
        )}
      </KitPartCard>
    </div>
  )
}

/** A quote as the commenter selected it: its words, or the words at each end of a long or cross-block one. */
function quoteText(quote: Quote): string {
  return quote.end ? `${quote.start} … ${quote.end}` : quote.start
}

/** Which one it is part of: its title, after the icon that says what it is (a file is labelled by its type). */
function headingOf(object: ForeignObject): string {
  const title = object.slots.title?.isPubkey ? undefined : object.slots.title?.value
  return title || objectLabel(object) || 'Untitled'
}
