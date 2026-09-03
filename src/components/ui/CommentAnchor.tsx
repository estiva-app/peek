import { resolveBlockAnchor, inlineTextOf, type ContentFormat } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { cn } from '@/lib/utils'

/**
 * Which part of another app's object a comment is about — SPEC §13.6.
 *
 * A comment filed in Ship against one paragraph of an issue description arrives
 * here as an ordinary message in the shared Folder, carrying a `block` tag.
 * Peek is not Ship and does not know what a Ship description is; what it has is
 * the **projection** — `slots.body`, with the content format the owner declared
 * — and that is enough to resolve the anchor and say what it points at.
 *
 * That is the whole claim RIC-7 is testing. One app anchoring and reading its
 * own comments proves nothing; this is the other app.
 *
 * **The failures are the reason this renders anything at all.** §13.6 requires
 * a reader to distinguish detached from unanchored, because they look identical
 * and mean opposite things — a remark about a deleted paragraph versus a remark
 * about the whole object. Two further states exist here that do not exist in
 * the owning app, and both are worded as ignorance rather than as loss:
 *
 * - the referenced object has not resolved yet, or at all
 * - it resolved but declares no `body` slot, so Peek cannot see its parts
 *
 * Saying "that paragraph was deleted" in either case would be a confident wrong
 * answer about somebody else's data, which is the failure RFC 0.4 §13.1 warns
 * about throughout the projection layer.
 */
export function CommentAnchor({
  blockId,
  object,
  className,
}: {
  blockId?: string
  /** The object the comment is about, as the projection layer resolved it. */
  object?: ForeignObject
  className?: string
}) {
  if (!blockId) return null

  const note = (state: string, children: React.ReactNode) => (
    <div
      data-comment-anchor={state}
      data-block-id={blockId}
      className={cn('border-l-2 border-border-default pl-2 text-xs text-text-tertiary', className)}
    >
      {children}
    </div>
  )

  // Not resolved: nothing is known about the object, so nothing is known about
  // its parts. Not the same as the part being gone.
  if (!object) return note('unresolved', 'About one part of the referenced object.')

  const body = object.slots.body
  if (!body) return note('no-body', 'About one part of the referenced object.')

  const anchor = resolveBlockAnchor(blockId, body.value, (body.format ?? 'marker') as ContentFormat)
  if (anchor.state === 'resolved') {
    const text = inlineTextOf(anchor.block).trim()
    return (
      <div
        data-comment-anchor="resolved"
        data-block-id={blockId}
        className={cn('border-l-2 border-border-strong pl-2 text-xs text-text-tertiary', className)}
      >
        <span className="line-clamp-2 italic">{text || 'an empty block'}</span>
      </div>
    )
  }
  if (anchor.state === 'detached') {
    return note('detached', 'The part this refers to has since been deleted.')
  }
  // `unaddressable` — the body is not written in parts. Nothing was deleted.
  return note('unaddressable', 'About one part of the referenced object, which is not written in parts.')
}
