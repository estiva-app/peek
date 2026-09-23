import { WithTooltip } from './WithTooltip'
import { formatReplyTimestamp } from '@/api/format'

/**
 * "(edited)" beside a message's time — RFC 0.4 §7.2.1's marker (CON-8).
 *
 * An edit on the relay is a `kind:40003` that every reader folds newest-wins,
 * and the rule that makes that safe is that the reader is *told*: a body that
 * silently changed under a reply written against the old text misattributes
 * the reply. So the marker is not decoration; it is the half of the edit
 * contract the reader sees. Peek had no such marker before FOL-31 — its own
 * edits patched the Convex row in place — which is why this is a primitive of
 * its own rather than a line in one card: every card that draws a body draws
 * it, whichever store the body came from.
 *
 * The time it was edited is in the tooltip rather than inline, so the header
 * stays one line. Nothing is drawn when there was no edit.
 *
 * @registry reusable: stays in Peek — it was the one part put forward for the package and Katerina ruled on 23 September that it is not promoted
 */
export function EditedMarker({ editedAt }: { editedAt?: number }) {
  if (!editedAt) return null
  return (
    <WithTooltip label={`Edited ${formatReplyTimestamp(editedAt)}`} wrapperClassName="shrink-0">
      <span className="text-caption text-text-muted whitespace-nowrap">(edited)</span>
    </WithTooltip>
  )
}
