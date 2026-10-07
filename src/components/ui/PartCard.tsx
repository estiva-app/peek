import { useState } from 'react'
import { renderTreeText, serializeBlockDocument, toRenderTree, type Block } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { Button, Card, Link, RichText } from '@estiva-app/ui'
import { usePart } from '@/api'
import { objectLabel } from '@/lib/appName'
import { cn } from '@/lib/utils'
import { DialogShell } from './DialogShell'
import { ForeignObjectSkeleton } from './ForeignObjectWidget'

/** Past this many characters a block is drawn cut, and opens whole in a dialog. */
const LONG_TEXT = 280
/** A table with more rows than this is drawn cut too. */
const LONG_TABLE_ROWS = 4

/**
 * One block of another object, live inside a message — SPEC §13.6.1, COM-2.
 *
 * Drawn the way an attachment is (Miky, kickoff 2026-10-07): the object's type
 * and title, then the block — whole when it is short; cut, the way an image is
 * a thumbnail, when it is long, and a click opens it whole in a dialog with the
 * way into the app it came from.
 *
 * **Five states, and two of them must never look alike.** A block somebody
 * deleted says so; a block the reader may not see says only that it is not
 * available — no title and no text, because either would tell them something
 * about a Folder they are not in, and a different frame so that "gone" and
 * "not yours" cannot be mistaken for each other.
 */
export function PartCard({ address, block }: { address: string; block: string }) {
  const view = usePart({ address, block })
  const [open, setOpen] = useState(false)

  if (view.state === 'loading') return <ForeignObjectSkeleton className="mt-1" />

  if (view.state === 'unreadable') {
    // The package's look for something that could not be read: a dashed hairline.
    return (
      <Card fill="inset" unreadable data-part="unreadable" data-part-address={address} className="mt-1 px-3 py-2">
        <span className="text-caption text-text-muted">Not available to you</span>
      </Card>
    )
  }
  if (view.state === 'deleted') {
    return (
      <Card fill="inset" data-part="deleted" data-part-address={address} className="mt-1 px-3 py-2">
        <span className="text-caption text-text-muted">Deleted</span>
      </Card>
    )
  }

  const heading = headingOf(view.object)
  const source = (
    <span className="contents text-caption font-semibold text-text-secondary">
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
      <Card fill="inset" data-part={view.state} data-part-address={address} className="mt-1 flex flex-col gap-1 px-3 py-2">
        {source}
        <span className="text-caption text-text-muted">{view.state === 'detached' ? 'This part was deleted' : "This part can't be shown"}</span>
      </Card>
    )
  }

  const blocks = toRenderTree(serializeBlockDocument({ type: 'doc', content: [view.block] }), 'blocks')
  const long = isLong(view.block, renderTreeText(blocks))
  return (
    <Card fill="inset" data-part="resolved" data-part-address={address} data-part-block={block} className="mt-1 flex flex-col gap-1 p-3">
      {source}
      {long ? (
        /* Cut, as an image is a thumbnail; the whole block opens in a dialog.
           The package has no "press the content to open it" part, so the way
           in is a Button under the cut rather than the cut itself. */
        <>
          <div className="relative max-h-40 overflow-hidden">
            <RichText blocks={blocks} size="small" />
            <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-bg-inset" />
          </div>
          <Button variant="muted" size="small" data-part-open className="self-start" onClick={() => setOpen(true)}>
            Show all
          </Button>
        </>
      ) : (
        <RichText blocks={blocks} size="small" />
      )}
      {open && (
        <DialogShell
          title={heading}
          onClose={() => setOpen(false)}
          bodyMaxHeight="max-h-[70vh]"
          footer={
            view.link ? (
              <Link href={view.link} external>
                Open in {view.object.appName ?? 'app'} ↗
              </Link>
            ) : undefined
          }
        >
          <RichText blocks={blocks} size="small" />
        </DialogShell>
      )}
    </Card>
  )
}

/** "Issue · Plan the launch": what it is, then which one (label objects by type). */
function headingOf(object: ForeignObject): string {
  const label = objectLabel(object)
  const title = object.slots.title?.isPubkey ? undefined : object.slots.title?.value
  return [label, title].filter(Boolean).join(' · ') || 'Untitled'
}

/** Long enough to cut: lengthy text, any image, or a table of more than a few rows. */
function isLong(block: Block, text: string): boolean {
  if (block.type === 'image') return true
  if (block.type === 'table') return (block.content?.length ?? 0) > LONG_TABLE_ROWS
  return text.length > LONG_TEXT
}
