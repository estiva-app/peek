import { useIsTopicResolved, useScreenerPreview, type ScreenerPreviewRow } from '@/api'
import { Avatar } from './ui/Avatar'
import { MessageBody } from './ui/MessageBody'
import { SkeletonBar } from './ui/Skeleton'
import { MetaText } from '@/components/ui/MetaText'

/**
 * The rows of the preview — the triggering message plus its recent replies, or
 * a skeleton while they load.
 *
 * It holds no box of its own: the surface, the 360px, the padding, the 300px
 * cap and the scrollbar are the package's `PreviewCard`, which was built from
 * this file (P27) and carries its numbers.
 */
/**
 * What the hover preview of a Screener item shows: the message that brought it
 * in and its latest replies, or grey bars while they load.
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
              <span className="text-h5 leading-tight text-text-primary">{r.authorName}</span>
              <MetaText size="chip" className="leading-tight">{r.timestamp}</MetaText>
            </div>
            <div className="text-caption leading-normal text-text-secondary line-clamp-4">
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
