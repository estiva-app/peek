/**
 * People reads — the workspace directory.
 *
 * Convex-backed when a deployment is configured; static mocks otherwise.
 * `avatarSrc` prefers the person's uploaded avatar and falls back to the
 * seeded demo portrait (name-keyed `avatarFor`), so the demo dataset keeps
 * its faces while real sign-ups show theirs.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import type { SignedEvent } from '@estiva-app/protocol'
import { api } from '../../convex/_generated/api'
import { PEOPLE as MOCK_PEOPLE, avatarFor } from '@/data/peopleData'
import { validToken, type StoredToken } from '@/auth/estivaId'
import { queryRelay } from '@/nostr/bridge'
import { workspaceFilters, workspacePeopleOf } from '@/nostr/workspacePeople'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { hasConvex } from './store'
import { RELAY_URL, hasRelay } from './relayUrl'
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

/** One read per minute, shared by every caller on screen. */
let workspaceCache: { at: number; events: SignedEvent[] } | null = null
let workspaceInFlight: Promise<SignedEvent[]> | null = null

function readWorkspace(relayUrl: string, token: StoredToken): Promise<SignedEvent[]> {
  if (workspaceCache && Date.now() - workspaceCache.at < 60_000) return Promise.resolve(workspaceCache.events)
  workspaceInFlight ??= queryRelay(relayUrl, workspaceFilters(), token.accessToken, token.pubkey)
    .then((result) => {
      if (!result.ok) throw new Error(result.reason ?? 'the relay did not answer')
      workspaceCache = { at: Date.now(), events: result.events }
      return result.events
    })
    .finally(() => {
      workspaceInFlight = null
    })
  return workspaceInFlight
}

/**
 * Everyone the viewer can DM, from the relay — REM-3.
 *
 * The workspace's roster, named by each member's profile, humans only and
 * never the viewer (`workspacePeopleOf` says why each). A person's `id` **is**
 * their pubkey: it is what a DM route, a star and an open-work entry are keyed
 * by, and the one key every app can read.
 *
 * `include` keeps people the viewer already has a DM with on the list after
 * they leave the roster. `undefined` while the first read is in flight; demo
 * mode answers from the mock cast, whose ids are its own.
 */
export function useWorkspacePeople(include: readonly string[] = NONE): Person[] | undefined {
  const [events, setEvents] = useState<SignedEvent[] | undefined>(() => workspaceCache?.events)

  const refresh = useCallback(() => {
    const token = validToken()
    if (!hasRelay || !RELAY_URL || !token) return
    readWorkspace(RELAY_URL, token)
      .then(setEvents)
      .catch((error) => console.warn('[people] could not read the workspace from the relay:', error))
  }, [])
  useEffect(refresh, [refresh])
  useRefreshTriggers(refresh, { enabled: hasRelay, interval: false })

  const includeKey = include.join(',')
  return useMemo(() => {
    if (!hasRelay) return MOCK_PEOPLE
    if (events === undefined) return undefined
    const extra = includeKey ? includeKey.split(',') : []
    return workspacePeopleOf(events, validToken()?.pubkey, extra).map((p) => ({
      id: p.pubkey,
      name: p.name,
      role: '',
      avatarSrc: p.picture,
      pubkey: p.pubkey,
    }))
  }, [events, includeKey])
}

const NONE: readonly string[] = []

/** A person's DM id is their pubkey (REM-3): 64 lowercase hex. */
export function isPersonKey(id: string): boolean {
  return /^[0-9a-f]{64}$/.test(id)
}

/**
 * Pubkey to name for everyone Peek can name, for resolving mentions.
 *
 * Deliberately not {@link usePeople}: that one is the suggestion list and
 * excludes both the viewer and relay-only identities, which is right for
 * "who can I @" and wrong for "who is this key".
 */
export function useMentionNames(): Array<{ pubkey: string; name: string }> | undefined {
  const remote = useQuery(api.people.mentionNames, hasConvex ? {} : 'skip')
  if (!hasConvex) {
    return MOCK_PEOPLE.flatMap((p) => (p.pubkey ? [{ pubkey: p.pubkey, name: p.name }] : []))
  }
  return remote
}
