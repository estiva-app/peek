import { Navigate, useParams } from 'react-router-dom'
import { EmptyState } from '@estiva-app/ui'
import { legacyTopicDestination } from '@/lib/legacyTopicLinks'

/**
 * `/topics/<id>` and `/topic-old/<ref>` — an old topic link, sent on to its
 * file (FOL-26).
 *
 * These routes rendered `TopicsPage`, which read Convex and could still reach
 * the topic writes CON-8 does not refuse. Now they draw nothing: the table in
 * `legacyTopicLinks` says where the conversation is, and the file page takes
 * it from there, canonicalising the URL once it knows the title. A `?huddle=`
 * or other search is dropped, because nothing on a file answers it.
 */
export function LegacyTopicRedirect() {
  const { id, ref } = useParams<{ id?: string; ref?: string }>()
  const destination = legacyTopicDestination(ref ?? id ?? '')
  if (destination) return <Navigate to={destination} replace />
  return (
    <div className="flex min-h-screen flex-col">
      <EmptyState message="That link does not point at anything Peek can open." />
    </div>
  )
}
