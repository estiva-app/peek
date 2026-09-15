import { cn } from '@/lib/utils'
import { AvatarGroup } from './AvatarGroup'
import { Button } from './Button'

/**
 * Who is in this conversation: up to three faces and the total, in a small
 * outlined pill.
 *
 * **One pill, two headers** (COMPONENTS-PEEK F12). `ConversationHeader` drew
 * this and `ThreadPanel` re-typed it, down to the `pl-[2px] pr-2 py-[2px]` — and
 * the copy had drifted: it stacked its own faces in `size-6 rounded-sm
 * overflow-hidden border-2` boxes, which is the shape the package's
 * `AvatarGroup` was built to replace. `overflow-hidden` clips the face and the
 * right edge of the initials with it, and a `border` is taken out of the inside,
 * so a 24px avatar showed 20px of face. The package draws its ring as a shadow,
 * outside the face, so 24 means 24.
 *
 * `disabled` rather than a different element when there is nothing to press —
 * which is what the header already did for a huddle, whose membership is set at
 * creation. Keeping one element keeps one set of pixels.
 */
export function MembersPill({
  members,
  count,
  onClick,
  className,
}: {
  /** The names, in order. Up to three faces are drawn. */
  members: string[]
  /** The number shown beside the faces. Defaults to how many names there are. */
  count?: number
  onClick?: () => void
  className?: string
}) {
  const total = count ?? members.length
  if (total === 0) return null
  return (
    /*
      The package's Button, outlined, at its default 32px (UIG-3, Katerina's
      pick of 15 September): the faces sit 3px inside the hairline on the top,
      the bottom and the left, 8px from the count. The small size is 24px, the
      faces' own height, so they covered the hairline.
    */
    <Button
      variant="outlined"
      aria-label={`${total} members`}
      disabled={!onClick}
      onClick={onClick}
      className={cn('gap-2 pl-[3px] pr-2', className)}
    >
      <AvatarGroup members={members} />
      <span className="text-caption text-text-secondary signal:font-mono signal:text-small signal:tabular-nums">{total}</span>
    </Button>
  )
}
