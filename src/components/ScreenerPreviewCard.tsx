import { createPortal } from 'react-dom'
import { useIsTopicResolved, useScreenerPreview, type ScreenerPreviewRow } from '@/api'
import { Avatar } from './ui/Avatar'
import { MessageBody } from './ui/MessageBody'
import { SkeletonBar } from './ui/Skeleton'

/**
 * Presentational preview box — the triggering message plus its recent replies
 * (or a skeleton while loading). Position-agnostic; `ScreenerPreviewCard`
 * portals and positions it beside the hovered Screener row.
 */
export function ScreenerPreviewCardView({
  rows,
  isTopicResolved,
}: {
  /** `undefined` = loading (renders the skeleton); otherwise the rows to show. */
  rows: ScreenerPreviewRow[] | undefined
  isTopicResolved: (topicId: string) => boolean
}) {
  return (
    <div className="w-[360px] bg-bg-elevated border border-border-default rounded-lg shadow-lg p-3 flex flex-col gap-3 max-h-[300px] overflow-y-auto [&>*]:shrink-0">
      {rows === undefined ? (
        <div className="flex flex-col gap-2">
          <SkeletonBar className="w-32" />
          <SkeletonBar className="w-full" />
          <SkeletonBar className="w-3/4" />
        </div>
      ) : (
        rows.map((r, i) => (
          <div key={i} className={r.kind === 'reply' ? 'flex flex-col gap-1 pl-3 border-l border-border-subtle' : 'flex flex-col gap-1'}>
            <div className="flex items-center gap-2">
              <Avatar size={16} name={r.authorName} alt={r.authorName} />
              <span className="text-[12px] font-medium leading-[1.3] text-text-primary">{r.authorName}</span>
              <span className="text-[11px] leading-[1.2] text-text-muted signal:font-mono signal:text-[10px] signal:tracking-[0.02em] signal:tabular-nums">{r.timestamp}</span>
            </div>
            <div className="text-[12px] leading-[1.45] text-text-secondary line-clamp-4">
              <MessageBody body={r.body} isTopicResolved={isTopicResolved} />
            </div>
          </div>
        ))
      )}
    </div>
  )
}

/**
 * Hover preview for a Screener row (user request 2026-07-09): the Screener
 * itself is only a snippet, so hovering shows more of the actual conversation.
 * Portalled and positioned beside the row so it can overflow the Desk panel.
 */
export function ScreenerPreviewCard({
  itemId,
  anchor,
}: {
  itemId: string
  anchor: DOMRect
}) {
  const rows = useScreenerPreview(itemId)
  const isTopicResolved = useIsTopicResolved()
  if (rows !== undefined && rows.length === 0) return null

  const WIDTH = 360
  // Prefer the right of the row; flip left if it would run off-screen.
  const spaceRight = window.innerWidth - anchor.right
  const left = spaceRight > WIDTH + 24 ? anchor.right + 12 : Math.max(12, anchor.left - WIDTH - 12)
  const top = Math.min(anchor.top, window.innerHeight - 320)

  return createPortal(
    <div className="fixed z-50 pointer-events-none" style={{ left, top }}>
      <ScreenerPreviewCardView rows={rows} isTopicResolved={isTopicResolved} />
    </div>,
    document.body,
  )
}
