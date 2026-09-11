import { useIsTopicResolved, useScreenerPreview, type ScreenerPreviewRow } from '@/api'
import { Avatar } from './ui/Avatar'
import { MessageBody } from './ui/MessageBody'
import { SkeletonBar } from './ui/Skeleton'

/**
 * The rows of the preview — the triggering message plus its recent replies, or
 * a skeleton while they load.
 *
 * It holds no box of its own: the surface, the 360px, the padding, the 300px
 * cap and the scrollbar are the package's `PreviewCard`, which was built from
 * this file (P27) and carries its numbers.
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
    <>
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
    </>
  )
}

/**
 * Hover preview for a Screener row (user request 2026-07-09): the Screener
 * itself is only a snippet, so hovering shows more of the actual conversation.
 *
 * This is what the card holds; `ScreenerItem` hands it to `PreviewCard` as the
 * `content`, which renders it only while the card is open — so the query still
 * runs on hover and not before, as it did when this file mounted itself.
 */
export function ScreenerPreviewContent({ itemId }: { itemId: string }) {
  const rows = useScreenerPreview(itemId)
  const isTopicResolved = useIsTopicResolved()
  return <ScreenerPreviewCardView rows={rows} isTopicResolved={isTopicResolved} />
}
