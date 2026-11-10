import { useRef, type ReactNode } from 'react'
import { Button, Card, MetaText, Person, PreviewCard } from '@estiva-app/ui'
import { cn } from '@/lib/utils'
import type { ActivityItem, Colour, Place } from './fixtures'
import { lit } from './rules'

/** How a row with both blue and orange draws its dot: Miky picks one on the preview. */
export type BothLook = 'blue-wins' | 'ring'

const VERB: Record<ActivityItem['what'], (i: ActivityItem) => string> = {
  conversation: () => 'started a conversation',
  reply: () => 'replied in your conversation',
  mention: () => 'mentioned you',
  reaction: (i) => `reacted ${i.emoji ?? ''} to your message`,
  message: () => 'wrote',
}

/** The 6px disc, in the dot's two colours: the card's and the list's key to which is which. */
export function Disc({ colour }: { colour: Colour }) {
  return <span aria-hidden className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', colour === 'orange' ? 'bg-warning-default' : 'bg-accent-primary')} />
}

/** One thing that lit the place: who, what, where, when, and the words. */
export function ActivityLine({ item, onOpen, quiet = false }: { item: ActivityItem; onOpen?: (item: ActivityItem) => void; quiet?: boolean }) {
  return (
    <Card fill="none" quietUntilHover hover="fill" onClick={() => onOpen?.(item)} className="flex gap-2 p-2">
      {quiet ? <span className="w-1.5 shrink-0" /> : <Disc colour={item.colour} />}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
          <span className="flex min-w-0 shrink-0 text-h5 leading-tight text-text-primary">
            <Person size={16} name={item.who} />
          </span>
          <span className="truncate">{VERB[item.what](item)}</span>
          <MetaText size="chip" className="ml-auto shrink-0">
            {item.ago}
          </MetaText>
        </div>
        {/* Where: the space or chat on a team's page, the listed file, then the words. */}
        <div className="truncate text-caption text-text-muted">
          {(item.in || item.file) && <span className="text-text-secondary">{[item.in, item.file].filter(Boolean).join(' › ')} · </span>}
          {item.text}
        </div>
      </div>
    </Card>
  )
}

/** The most the card lists; the rest are a line that opens For you. */
export const CARD_ROWS = 5

/** What the hover card holds: what lit the place, newest first. */
export function ActivityCardContent({ items, onOpen, onForYou }: { items: ActivityItem[]; onOpen?: (item: ActivityItem) => void; onForYou?: () => void }) {
  const shown = items.slice(0, CARD_ROWS)
  const more = items.length - shown.length
  return (
    <div className="flex flex-col gap-0.5">
      {shown.map((i) => (
        <ActivityLine key={i.id} item={i} onOpen={onOpen} />
      ))}
      {/* Only what is new (Miky, 10 Nov): a last line only when more is new than the card holds. */}
      {onForYou && more > 0 && (
        <Button variant="muted" size="small" onClick={onForYou} className="self-start">
          {`${more} more`}
        </Button>
      )}
    </div>
  )
}

/**
 * A column's row with the dot that explains itself. The row is Peek's own
 * (TreeRow, NavItem, PersonItem), drawn with `unread`; this recolours its dot
 * for orange, or rings it, and puts the hover card on the row.
 *
 * The card opens on the whole row, as the Screener's preview does: a row with
 * a "⋮" hides its dot under the pointer today, so a dot-only target would
 * vanish as it is reached.
 */
export function ActivityRow({
  place,
  cleared,
  look,
  touch = false,
  onHovered,
  onOpenItem,
  onForYou,
  children,
}: {
  place: Place
  cleared: ReadonlySet<string>
  look: BothLook
  /** A screen with no hover: no card; opening the place is what clears. */
  touch?: boolean
  /** The card was open: its orange is seen. */
  onHovered?: (place: Place) => void
  onOpenItem?: (place: Place, item: ActivityItem) => void
  onForYou?: (place: Place) => void
  children: ReactNode
}) {
  const { blue, orange, open } = lit(place, cleared)
  const since = useRef<number | null>(null)
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Orange alone recolours the dot; with blue, either blue wins or the dot is ringed.
  // Joined by hand, not `cn()`: merging reads the ring's width and colour as one and drops one of them.
  const mark =
    orange && !blue
      ? '[&_[data-unread]>div]:bg-warning-default'
      : orange && blue && look === 'ring'
        ? '[&_[data-unread]>div]:outline [&_[data-unread]>div]:outline-2 [&_[data-unread]>div]:outline-offset-1 [&_[data-unread]>div]:outline-warning-default'
        : ''
  const row = <div className={`block w-full ${mark}`}>{children}</div>
  if (touch || open.length === 0) return row
  // The orange is seen once the card has been open and closes: the pointer stayed past the card's 350ms, then left
  // both the row and the card. Cleared only then, so the card does not empty while it is read.
  const enter = () => {
    if (closing.current) clearTimeout(closing.current)
    closing.current = null
    if (since.current === null) since.current = Date.now()
  }
  const leave = () => {
    closing.current = setTimeout(() => {
      if (since.current !== null && Date.now() - since.current > 750) onHovered?.(place)
      since.current = null
    }, 400)
  }
  return (
    <div className="block w-full" onPointerEnter={enter} onPointerLeave={leave}>
      <PreviewCard
        content={
          <div onPointerEnter={enter} onPointerLeave={leave}>
            <ActivityCardContent items={open} onOpen={(i) => onOpenItem?.(place, i)} onForYou={onForYou && (() => onForYou(place))} />
          </div>
        }
        contentClassName="p-1"
        wrapperClassName="block w-full"
      >
        {row}
      </PreviewCard>
    </div>
  )
}
