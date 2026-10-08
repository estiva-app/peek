import { serializeBlockDocument, toRenderTree } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { AttachmentCard, Button, Card, Link, RichText, ShowMore, type RichTextBlock } from '@estiva-app/ui'
import { IconExternalLink } from '@tabler/icons-react'
import { usePart, type PartView } from '@/api'
import { objectLabel } from '@/lib/appName'
import { postedAttachment } from '@/lib/fileAttachments'
import { blobObjectUrl } from '@/nostr/media'
import { ForeignObjectSkeleton } from './ForeignObjectWidget'

/**
 * Past this height a block is cut behind ShowMore's fade, and opens in place.
 * The package's default is 96px; 160px is the cut this card had before it took
 * ShowMore (about six table rows), so a short table is still drawn whole.
 */
const CUT_AT = 160

/**
 * One block of another object, live inside a message — SPEC §13.6.1, COM-2.
 * This one reads it (`usePart`); `PartCardView` draws what the read gave.
 */
export function PartCard({ address, block }: { address: string; block: string }) {
  return <PartCardView view={usePart({ address, block })} address={address} block={block} />
}

/**
 * One block of another object, drawn from a read that has already happened.
 *
 * Drawn the way an attachment is (Miky, kickoff 2026-10-07): the object's type
 * and title, then the block — whole when it is short; cut behind ShowMore's fade
 * when it is long, and opened in place (Katerina, 2026-10-08). The way into the
 * app it came from is a Button with an open-out icon, level with Show more.
 *
 * **Five states, and two of them must never look alike.** A block somebody
 * deleted says so; a block the reader may not see says only that it is not
 * available — no title and no text, because either would tell them something
 * about a Folder they are not in, and a different frame so that "gone" and
 * "not yours" cannot be mistaken for each other. Every state that shows no
 * block is said in italic.
 */
export function PartCardView({
  view,
  address,
  block,
  fetchImage = blobObjectUrl,
}: {
  view: PartView
  address: string
  block: string
  /** How a picture in the block is fetched: Peek's authenticated fetch, unless a story hands it a picture it already has. */
  fetchImage?: (mediaUrl: string) => Promise<string>
}) {
  if (view.state === 'loading') return <ForeignObjectSkeleton className="mt-1" />

  if (view.state === 'unreadable') {
    // The package's look for something that could not be read: a dashed hairline.
    return (
      <Card fill="inset" unreadable data-part="unreadable" data-part-address={address} className="mt-1 px-3 py-2">
        <span className="text-caption italic text-text-muted">Not available to you</span>
      </Card>
    )
  }
  if (view.state === 'deleted') {
    return (
      <Card fill="inset" data-part="deleted" data-part-address={address} className="mt-1 px-3 py-2">
        <span className="text-caption italic text-text-muted">Deleted</span>
      </Card>
    )
  }

  const heading = headingOf(view.object)
  const source = (
    <span className="contents text-h5 text-text-primary">
      {view.link ? (
        <Link href={view.link} variant="quiet" external truncate>
          {heading}
        </Link>
      ) : (
        heading
      )}
    </span>
  )

  if (view.state !== 'resolved') {
    return (
      <Card fill="inset" data-part={view.state} data-part-address={address} className="mt-1 flex flex-col gap-3 px-3 py-2">
        {source}
        <span className="text-caption italic text-text-muted">{view.state === 'detached' ? 'This part was deleted' : "This part can't be shown"}</span>
      </Card>
    )
  }

  const blocks = toRenderTree(serializeBlockDocument({ type: 'doc', content: [view.block] }), 'blocks')
  const content = <RichText blocks={blocks} size="small" renderBlock={(b) => renderAttachment(b, fetchImage)} />
  const link = view.link
  // A Button, not a Link, by Katerina's call (2026-10-08): the way out of Peek
  // reads as an action, level with Show more at the right of its row.
  const openIn = link ? (
    <Button size="small" leadingIcon={<IconExternalLink stroke={1.5} className="size-3.5" />} onClick={() => window.open(link, '_blank', 'noopener,noreferrer')}>
      Open in {view.object.appName ?? 'app'}
    </Button>
  ) : undefined
  return (
    <Card fill="inset" data-part="resolved" data-part-address={address} data-part-block={block} className="mt-1 flex flex-col gap-3 p-3">
      {source}
      {/* An attachment is never cut (no height reaches Infinity): its card is
          already the thumbnail, and a click on it opens the full picture as it
          does on a message's own. ShowMore still draws the row for Open in. */}
      <ShowMore surface="inset" maxHeight={view.block.type === 'attachment' ? Infinity : CUT_AT} action={openIn}>
        {content}
      </ShowMore>
    </Card>
  )
}

/**
 * An attachment block — an image is one (SPEC §13.3) — drawn as a message's
 * attachment is, through the same card and the same authenticated fetch.
 * `RichText` has no design of its own for it.
 */
function renderAttachment(block: RichTextBlock, fetchImage: (mediaUrl: string) => Promise<string>) {
  if (block.type !== 'attachment') return undefined
  const attr = (key: string) => (typeof block.attrs?.[key] === 'string' ? (block.attrs[key] as string) : undefined)
  const size = typeof block.attrs?.size === 'number' ? block.attrs.size : 0
  return (
    <AttachmentCard
      {...postedAttachment({ name: attr('filename') ?? 'Attachment', size, contentType: attr('m') ?? '', mediaUrl: attr('url'), thumbUrl: attr('thumb') })}
      fetchImage={fetchImage}
      download
    />
  )
}

/** "Issue · Plan the launch": what it is, then which one (label objects by type). */
function headingOf(object: ForeignObject): string {
  const label = objectLabel(object)
  const title = object.slots.title?.isPubkey ? undefined : object.slots.title?.value
  return [label, title].filter(Boolean).join(' · ') || 'Untitled'
}
