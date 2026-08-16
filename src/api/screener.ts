/**
 * Screener hover preview — more of the thread than the two-line snippet.
 * Only fetched while a row is actually hovered ('skip' otherwise), so the
 * Desk doesn't query a preview for every item it renders.
 */
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { CURRENT_USER_NAME, useCurrentUser } from './currentUser'
import { formatReplyTimestamp } from './format'
import { hasConvex } from './store'

export interface ScreenerPreviewRow {
  authorName: string
  timestamp: string
  body: string
  kind: 'message' | 'reply'
}

/** `undefined` = still loading; `[]` = nothing to show (or mock mode). */
export function useScreenerPreview(itemId: string | null): ScreenerPreviewRow[] | undefined {
  const me = useCurrentUser()
  const remote = useQuery(
    api.screener.preview,
    hasConvex && itemId ? { itemId } : 'skip',
  )
  if (!hasConvex || !itemId) return []
  if (remote === undefined) return undefined
  return (remote ?? []).map((r) => ({
    authorName: r.authorId === me?.id ? CURRENT_USER_NAME : r.authorName,
    // The popover floats with no date dividers, so each row's label carries
    // its own day once it isn't today (same rule as thread reply cards).
    timestamp: formatReplyTimestamp(r.createdAt),
    body: r.body,
    kind: r.kind,
  }))
}
