import { useCallback } from 'react'
import { useTopicLookup } from '@/api'
import { topicPath } from './objectUrl'

/**
 * Build a topic's path from its Peek id (PEE-14).
 *
 * Most link sites — the nav rail, Desk, a promotion divider, a huddle anchor —
 * hold only the id, and the shareable URL needs the topic's channel uuid and
 * title. Rather than teach each of them to look a topic up, they call this.
 *
 * A topic that cannot be found falls back to the legacy `/topics/<id>` path.
 * That happens in the window between creating a topic and the record coming
 * back, and it stays navigable inside Peek — which is what a link in the app's
 * own chrome needs. It is not shareable, and `TopicsPage` replaces it with the
 * canonical path as soon as the topic resolves.
 */
export function useTopicPath(): (
  topicId: string,
  opts?: { huddleId?: string | null },
) => string {
  const lookup = useTopicLookup()
  return useCallback(
    (topicId, opts) => topicPath(lookup(topicId) ?? { id: topicId }, opts),
    [lookup],
  )
}
