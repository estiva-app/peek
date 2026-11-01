import { useScreenerPreview, type ScreenerPreviewRow } from '@/api'
import { MetaText, Person, SkeletonBar } from '@estiva-app/ui'
import { MessageBody } from './ui/MessageBody'

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
}: {
  /** `undefined` = loading (renders the skeleton); otherwise the rows to show. */
  rows: ScreenerPreviewRow[] | undefined
}) {
  return (
    <>
      {rows === undefined ? (
        // SkeletonBar draws nothing of its own: each bar takes a height, a line of words' (they were 0px, so the card showed nothing).
        <div className="flex flex-col gap-2">
          <SkeletonBar className="h-3 w-32" />
          <SkeletonBar className="h-3 w-full" />
          <SkeletonBar className="h-3 w-3/4" />
        </div>
      ) : (
        rows.map((r, i) => (
          <div key={i} className={r.kind === 'reply' ? 'flex flex-col gap-1 pl-3 border-l border-border-subtle' : 'flex flex-col gap-1'}>
            <div className="flex items-center gap-2">
              {/* The kit's face beside a name, the size the card's words take. */}
              <Person size={16} name={r.authorName} bot={r.authorBot} className="text-h5 leading-tight text-text-primary" />
              <MetaText size="chip">{r.timestamp}</MetaText>
            </div>
            <div className="text-caption leading-normal text-text-secondary line-clamp-4">
              {/* A preview: its links as chips only (Decided 16 Oct). */}
              <MessageBody body={r.body} follow={false} preview />
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
  return <ScreenerPreviewCardView rows={rows} />
}
