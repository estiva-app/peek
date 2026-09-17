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
import { topicIdFromScreenerRowId } from '@/api/internal/screenerFold'

export interface ScreenerPreviewRow {
  authorName: string
  timestamp: string
  body: string
  kind: 'message' | 'reply'
}

/**
 * `undefined` = still loading; `[]` = nothing to show (or mock mode).
 *
 * A **folded** topic row asks by topic, not by row id (SHR-10): it has no
 * `screenerItems` document, so `normalizeId` would return null and the card
 * would open empty — indistinguishable from a conversation with nothing in it,
 * which is what made this worth routing rather than leaving to fall through.
 */
export function useScreenerPreview(itemId: string | null): ScreenerPreviewRow[] | undefined {
  const me = useCurrentUser()
  const topicKey = itemId ? topicIdFromScreenerRowId(itemId) : null
  const remote = useQuery(
    api.screener.preview,
    hasConvex && itemId ? (topicKey ? { topicKey } : { itemId }) : 'skip',
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
