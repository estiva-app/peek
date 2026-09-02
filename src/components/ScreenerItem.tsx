import { useRef, useState } from 'react'
import { IconX } from '@tabler/icons-react'
import { ScreenerPreviewCard } from './ScreenerPreviewCard'
import { ScreenerLaterMenu } from './ScreenerLaterMenu'
import { TopicState } from './ui/TopicState'
import { Avatar } from './ui/Avatar'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { useIsTopicResolved } from '@/api'
import { stripInlineFormatting } from '@estiva-app/protocol'
import type { ScreenerItem as ScreenerItemData } from '@/api'

interface ScreenerItemProps {
  item: ScreenerItemData
  /** "Open" → add to Open work. */
  onOpen?: (id: string) => void
  /** "Later" → snooze until the chosen absolute timestamp. */
  onLater?: (id: string, untilMs: number) => void
  onDismiss?: (id: string) => void
}

/** A single incoming item in the Desk Screener: who/what it is, a two-line preview,
 *  and the Open / Later / ✕ Dismiss triage actions. Rendered by ScreenerSection. */
/** Hovering has to linger — brushing past the list shouldn't flash preview cards. */
const HOVER_DELAY_MS = 350

export function ScreenerItem({ item, onOpen, onLater, onDismiss }: ScreenerItemProps) {
  const isTopicResolved = useIsTopicResolved()
  const rowRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)

  const openPreview = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const rect = rowRef.current?.getBoundingClientRect()
      if (rect) setAnchor(rect)
    }, HOVER_DELAY_MS)
  }
  const closePreview = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setAnchor(null)
  }

  return (
    <div
      ref={rowRef}
      onMouseEnter={openPreview}
      onMouseLeave={closePreview}
      className="flex flex-col p-2 rounded-lg transition-colors hover:bg-bg-hover has-[button:hover]:bg-transparent"
    >
      {anchor && <ScreenerPreviewCard itemId={item.id} anchor={anchor} />}
      {/* Item header */}
      <div className="flex items-center gap-2">
        {item.kind === 'topic' ? (
          <TopicState type="topic" status={isTopicResolved(item.topicId) ? 'resolved' : 'unresolved'} />
        ) : (
          <Avatar size={16} src={item.authorAvatarSrc} alt={item.authorName} />
        )}
        <span className="text-body-2-strong text-text-primary truncate">
          {item.kind === 'topic' ? item.topicTitle : item.authorName}
        </span>
      </div>

      {/* Preview */}
      <div className="pl-6 pr-2 py-1">
        <p className="text-caption text-text-secondary line-clamp-2">{stripInlineFormatting(item.preview)}</p>
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
}
