/**
 * People reads — the workspace directory, from the relay.
 *
 * One read answers all of it: the roster (`kind:13534`) and every profile
 * (`kind:0`), shared by every caller on screen. People (REM-3), the @-mention
 * and invite list, the names mentions render with and the viewer's own name and
 * face (REM-6) are each a view over that one answer — Convex's `users` table,
 * which used to be the copy all of these read, is not consulted.
 *
 * Demo mode (no relay) answers from the mock cast, whose ids are its own.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SignedEvent } from '@estiva-app/protocol'
import { PEOPLE as MOCK_PEOPLE } from '@/data/peopleData'
import { validToken, type StoredToken } from '@/auth/estivaId'
import { queryRelay } from '@/nostr/bridge'
import { readFromCopy } from '@/nostr/deviceCopy'
import {
  mentionablePeopleOf,
  profilesOf,
  workspaceFilters,
  workspacePeopleOf,
  type WorkspacePerson,
  type WorkspaceProfile,
} from '@/nostr/workspacePeople'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { RELAY_URL, hasRelay } from './relayUrl'
import type { Person } from './types'

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
 * The roster and every profile, as the relay last answered. `undefined` until
 * the first read lands, and in demo mode, which has no relay to ask.
 *
 * Read on mount and again on the app's refresh triggers (focus, reconnect), so
 * a rename in Estiva ID shows on the next load at the latest.
 */
function useWorkspaceEvents(): SignedEvent[] | undefined {
  const [events, setEvents] = useState<SignedEvent[] | undefined>(() => workspaceCache?.events)

  const refresh = useCallback(() => {
    const token = validToken()
    if (!hasRelay || !RELAY_URL || !token) return
    readWorkspace(RELAY_URL, token)
      .then(setEvents)
      .catch((error) => console.warn('[people] could not read the workspace from the relay:', error))
  }, [])
  useEffect(() => {
    // The names the copy on the device holds, until the relay's land (PEE-2).
    const token = validToken()
    if (hasRelay && RELAY_URL && token && !workspaceCache) {
      void readFromCopy(RELAY_URL, workspaceFilters(), token.pubkey).then((cached) => {
        if (cached?.length) setEvents((current) => current ?? cached)
      })
    }
    refresh()
  }, [refresh])
  useRefreshTriggers(refresh, { enabled: hasRelay, interval: false })

  return events
}

/** Parsed once per answer, however many hooks ask. */
const profilesByAnswer = new WeakMap<readonly SignedEvent[], Map<string, WorkspaceProfile>>()

function profilesFor(events: readonly SignedEvent[]): Map<string, WorkspaceProfile> {
  let profiles = profilesByAnswer.get(events)
  if (!profiles) {
    profiles = profilesOf(events)
    profilesByAnswer.set(events, profiles)
  }
  return profiles
}

const toPerson = (p: WorkspacePerson): Person => ({
  id: p.pubkey,
  name: p.name,
  role: '',
  avatarSrc: p.picture,
  pubkey: p.pubkey,
})

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
  const events = useWorkspaceEvents()
  const includeKey = include.join(',')
  return useMemo(() => {
    if (!hasRelay) return MOCK_PEOPLE
    if (events === undefined) return undefined
    const extra = includeKey ? includeKey.split(',') : []
    return workspacePeopleOf(events, validToken()?.pubkey, extra).map(toPerson)
  }, [events, includeKey])
}

const NONE: readonly string[] = []

/** A person's DM id is their pubkey (REM-3): 64 lowercase hex. */
export function isPersonKey(id: string): boolean {
  return /^[0-9a-f]{64}$/.test(id)
}

/**
 * Everyone the viewer can @-mention or invite: the roster, agents included,
 * never the viewer (`mentionablePeopleOf`). Ids are pubkeys, as on People.
 *
 * `undefined` while the first read is in flight — callers guard or render a
 * skeleton (see SkeletonSidebarList).
 */
export function usePeople(): Person[] | undefined {
  const events = useWorkspaceEvents()
  return useMemo(() => {
    if (!hasRelay) return MOCK_PEOPLE
    if (events === undefined) return undefined
    return mentionablePeopleOf(events, validToken()?.pubkey).map(toPerson)
  }, [events])
}

/**
 * Pubkey to name for everyone Peek can name, for resolving mentions.
 *
 * Deliberately not {@link usePeople}: that one is the suggestion list and
 * excludes the viewer and anyone off the roster, which is right for "who can I
 * @" and wrong for "who is this key".
 */
export function useMentionNames(): Array<{ pubkey: string; name: string }> | undefined {
  const profiles = useWorkspaceProfiles()
  return useMemo(() => {
    if (!hasRelay) return MOCK_PEOPLE.flatMap((p) => (p.pubkey ? [{ pubkey: p.pubkey, name: p.name }] : []))
    return profiles?.map(({ pubkey, name }) => ({ pubkey, name }))
  }, [profiles])
}

/**
 * Every named profile on the relay — the viewer, agents and people off the
 * roster included. `undefined` while loading and in demo mode.
 */
export function useWorkspaceProfiles(): WorkspaceProfile[] | undefined {
  const events = useWorkspaceEvents()
  return useMemo(() => (hasRelay && events ? [...profilesFor(events).values()] : undefined), [events])
}

/**
 * The signed-in pubkey and its profile, if it has one (REM-6).
 *
 * `undefined` until the first read lands, or with no session; `profile` is
 * absent for a key that has never published a name. Demo mode has no viewer
 * key and answers `undefined` — `useCurrentUser` owns the demo's viewer.
 */
export function useViewerProfile(): { pubkey: string; profile?: WorkspaceProfile } | undefined {
  const events = useWorkspaceEvents()
  const pubkey = validToken()?.pubkey
  return useMemo(() => {
    if (!hasRelay || !pubkey || events === undefined) return undefined
    const profile = profilesFor(events).get(pubkey)
    return profile ? { pubkey, profile } : { pubkey }
  }, [events, pubkey])
}
