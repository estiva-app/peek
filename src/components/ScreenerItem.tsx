import { useState, type MouseEvent, type ReactNode } from 'react'
import { IconX } from '@tabler/icons-react'
import { Avatar, Card, PreviewCard } from '@estiva-app/ui'
import { ScreenerPreviewContent } from './ScreenerPreviewCard'
import { ScreenerLaterMenu } from './ScreenerLaterMenu'
import { TopicState } from './ui/TopicState'
import { Button } from './ui/Button'
import { Chip } from './ui/Chip'
import { IconButton } from './ui/IconButton'
import { hasRelay } from '@/api'
import { previewText } from '@/lib/textParsing'
import { fileGlyph } from '@/lib/fileGlyph'
import type { ScreenerItem as ScreenerItemData } from '@/api'

interface ScreenerItemProps {
  item: ScreenerItemData
  /** "Open work" → add to Open work. */
  onOpen?: (id: string) => void
  /** "Later" → snooze until the chosen absolute timestamp. */
  onLater?: (id: string, untilMs: number) => void
  onDismiss?: (id: string) => void
  /**
   * A click on the row, or on its hover card: the item on its own page, to be
   * read (Katerina, 30 October). Leave it out and neither answers a click.
   */
  onRead?: (id: string) => void
  /**
   * What the hover card shows. The app leaves it out and gets
   * `ScreenerPreviewContent`, which reads the conversation. A story passes
   * `ScreenerPreviewCardView` with fixture rows — the only way the hover card
   * can be seen outside the app, since the read needs a backend (UIG-17).
   */
  preview?: ReactNode
}

/** A single incoming item in the Desk Screener: who/what it is, a two-line preview,
 *  and the Open work / Later / ✕ Dismiss triage actions. Rendered by ScreenerSection. */
export function ScreenerItem({ item, onOpen, onLater, onDismiss, onRead, preview }: ScreenerItemProps) {
  // The Later menu opens outside the row, so the row would go dark under its own menu.
  const [menuOpen, setMenuOpen] = useState(false)
  /*
    The row's buttons keep their own clicks, and so does the Later menu: it is
    a portal, outside the row in the page, but React still hands its clicks up
    to the row.
  */
  const readFromRow = onRead
    ? (event: MouseEvent<HTMLDivElement>) => {
        const target = event.target as Element
        if (!event.currentTarget.contains(target) || target.closest('button')) return
        onRead(item.id)
      }
    : undefined

  const row = (
    // A card in a feed (the package's `hover="fill"`): it lights when pointed at, and opens when clicked.
    <Card
      fill="none"
      quietUntilHover
      hover={onRead ? 'fill' : 'none'}
      hovered={menuOpen}
      onClick={readFromRow}
      className="flex flex-col p-2"
    >
      {/* Item header */}
      <div className="flex items-center gap-2">
        {item.kind === 'file' ? (
          // The tree's glyph rule (`fileGlyph`): a topic, a Ship project or issue, or a file.
          <TopicState type={fileGlyph(item.fileKind)} />
        ) : (
          <Avatar size={16} src={item.authorAvatarSrc} alt={item.authorName} />
        )}
        <span className="text-body-2-strong text-text-primary truncate">
          {item.kind === 'file' ? item.title : item.authorName}
        </span>
        {/* The chip Open work shows on an archived file (peek#515), always in sight here. */}
        {item.kind === 'file' && item.archived && <Chip type="neutral" label="Archived" className="shrink-0" />}
      </div>

      {/* Preview */}
      <div className="pl-6 pr-2 py-1">
        <p className="text-caption text-text-secondary line-clamp-2">{previewText(item.preview)}</p>
      </div>

      {/* Actions */}
      {/* Previous leading icons (dropped for visual calm): Open → IconPlus, Later → IconHistory */}
      <div className="flex items-center justify-between pl-6 pt-3">
        <div className="flex items-center gap-2">
          {/* It says where the item goes: "Open" read as "open it" (Katerina, 30 October). */}
          <Button variant="primary" size="small" onClick={() => onOpen?.(item.id)}>
            Open work
          </Button>
          <ScreenerLaterMenu onPick={(untilMs) => onLater?.(item.id, untilMs)} onOpenChange={setMenuOpen} />
        </div>
        <IconButton
          variant="outlined"
          tooltip="Dismiss"
          aria-label="Dismiss"
          onClick={() => onDismiss?.(item.id)}
        >
          <IconX size={16} stroke={1.5} />
        </IconButton>
      </div>
    </Card>
  )

  /*
    The preview needs a backend: with none, `useScreenerPreview` returns an
    empty list and the card would open on an empty box. Offered only where it
    can say something — the rule `AttachFileButton` already follows. A caller
    that brings its own `preview` has something to say, so the card opens for
    it whatever the backend: that is how the stories show the hover at all
    (UIG-17).

    The 350ms wait, the portal, the prefer-right-flip-left and the clamp against
    the bottom edge were all written here; they are `PreviewCard`'s now (P27),
    and 350ms is its default, so the number is not repeated. `block w-full` on
    the wrapper because the trigger is a row, and the component's own wrapper is
    an inline span.
  */
  /*
    Both kinds open a card, read from the relay (CON-14): a DM row's thread from
    the channel store, a file row's comment and its replies. With no backend
    there is nothing to read — unless a caller brings its own rows, which is how
    a story draws the card at all (UIG-17).
  */
  if (!hasRelay && !preview) return row
  const content = preview ?? <ScreenerPreviewContent itemId={item.id} />
  return (
    <PreviewCard
      /*
        The card opens the item too (Katerina, 30 October). It departs from
        PreviewCard's own page, which keeps a preview a read: here it is the
        same click as the row's, and the row stays the way to reach it.
      */
      content={
        onRead ? (
          <Card fill="none" quietUntilHover hover="fill" onClick={() => onRead(item.id)} className="flex flex-col gap-3 p-2">
            {content}
          </Card>
        ) : (
          content
        )
      }
      contentClassName={onRead ? 'p-1' : undefined}
      wrapperClassName="block w-full"
    >
      {row}
    </PreviewCard>
  )
}
