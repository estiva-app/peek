import type { ReactNode } from 'react'
import { IconX } from '@tabler/icons-react'
import { KIND_BARE_FILE } from '@estiva-app/interop'
import { PreviewCard } from '@estiva-app/ui'
import { ScreenerPreviewContent } from './ScreenerPreviewCard'
import { ScreenerLaterMenu } from './ScreenerLaterMenu'
import { TopicState } from './ui/TopicState'
import { Avatar } from './ui/Avatar'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { hasConvex } from '@/api'
import { previewText } from '@/lib/textParsing'
import type { ScreenerItem as ScreenerItemData } from '@/api'

interface ScreenerItemProps {
  item: ScreenerItemData
  /** "Open" → add to Open work. */
  onOpen?: (id: string) => void
  /** "Later" → snooze until the chosen absolute timestamp. */
  onLater?: (id: string, untilMs: number) => void
  onDismiss?: (id: string) => void
  /**
   * What the hover card shows. The app leaves it out and gets
   * `ScreenerPreviewContent`, which reads the conversation. A story passes
   * `ScreenerPreviewCardView` with fixture rows — the only way the hover card
   * can be seen outside the app, since the read needs a backend (UIG-17).
   */
  preview?: ReactNode
}

/** A single incoming item in the Desk Screener: who/what it is, a two-line preview,
 *  and the Open / Later / ✕ Dismiss triage actions. Rendered by ScreenerSection. */
export function ScreenerItem({ item, onOpen, onLater, onDismiss, preview }: ScreenerItemProps) {
  const row = (
    <div className="flex flex-col p-2 rounded-lg transition-colors hover:bg-bg-hover has-[button:hover]:bg-transparent">
      {/* Item header */}
      <div className="flex items-center gap-2">
        {item.kind === 'file' ? (
          // The tree's glyph rule: a bare-file topic draws as a topic, anything else as a file.
          <TopicState type={item.fileKind === KIND_BARE_FILE ? 'topic' : 'file'} />
        ) : (
          <Avatar size={16} src={item.authorAvatarSrc} alt={item.authorName} />
        )}
        <span className="text-body-2-strong text-text-primary truncate">
          {item.kind === 'file' ? item.title : item.authorName}
        </span>
      </div>

      {/* Preview */}
      <div className="pl-6 pr-2 py-1">
        <p className="text-caption text-text-secondary line-clamp-2">{previewText(item.preview)}</p>
      </div>

      {/* Actions */}
      {/* Previous leading icons (dropped for visual calm): Open → IconPlus, Later → IconHistory */}
      <div className="flex items-center justify-between pl-6 pt-3">
        <div className="flex items-center gap-2">
          <Button variant="primary" size="small" onClick={() => onOpen?.(item.id)}>
            Open
          </Button>
          <ScreenerLaterMenu onPick={(untilMs) => onLater?.(item.id, untilMs)} />
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
    </div>
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
  if (!hasConvex && !preview) return row
  return (
    <PreviewCard
      content={preview ?? <ScreenerPreviewContent itemId={item.id} />}
      wrapperClassName="block w-full"
    >
      {row}
    </PreviewCard>
  )
}
