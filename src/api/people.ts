/**
 * People reads — the workspace directory.
 *
 * Convex-backed when a deployment is configured; static mocks otherwise.
 * `avatarSrc` prefers the person's uploaded avatar and falls back to the
 * seeded demo portrait (name-keyed `avatarFor`), so the demo dataset keeps
 * its faces while real sign-ups show theirs.
 */
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { PEOPLE as MOCK_PEOPLE, avatarFor } from '@/data/peopleData'
import { hasConvex } from './store'
import type { Person } from './types'

/**
 * All people in the workspace, excluding the current user.
 * `undefined` while the Convex query is loading — callers guard or render
 * a skeleton (see SkeletonSidebarList).
 */
export function usePeople(): Person[] | undefined {
  const remote = useQuery(api.people.list, hasConvex ? {} : 'skip')
  if (!hasConvex) return MOCK_PEOPLE
  if (remote === undefined) return undefined
  return remote.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    avatarSrc: p.avatarUrl ?? avatarFor(p.name),
    pubkey: p.pubkey,
  }))
}
