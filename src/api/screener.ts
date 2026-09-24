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
import { fileAddressFromScreenerRowId } from '@/api/internal/screenerFold'

export interface ScreenerPreviewRow {
  authorName: string
  timestamp: string
  body: string
  kind: 'message' | 'reply'
}

/**
 * `undefined` = still loading; `[]` = nothing to show (or mock mode).
 *
 * A DM row asks by its Convex row id. A folded topic row asked by topic until
 * FOL-23 removed the topic half of the Screener.
 */
export function useScreenerPreview(itemId: string | null): ScreenerPreviewRow[] | undefined {
  const me = useCurrentUser()
  // A file row has no Convex side at all (FOL-34): its id is not a Convex id,
  // and handing it to the query would fail validation rather than answer.
  const isFileRow = itemId ? fileAddressFromScreenerRowId(itemId) !== null : false
  const remote = useQuery(api.screener.preview, hasConvex && itemId && !isFileRow ? { itemId } : 'skip')
  if (!hasConvex || !itemId || isFileRow) return []
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
