/**
 * Foreign-object reads and actions, through the seam.
 *
 * These used to be `useAction(api.nostr.foreign.…)` calls made straight from
 * two components, which reached past `@/api` and also handed the viewer's
 * bearer token to a Convex action. Both are fixed here: the relay work happens
 * in the browser (PEEK-106), and components ask `@/api` for it like everything
 * else.
 *
 * Every function resolves to `null` — or a readable reason — rather than
 * throwing. A reference that cannot be resolved must degrade to plain text; a
 * message is never broken because an attachment failed.
 */
import { useCallback, useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { validToken } from '@/auth/estivaId'
import { avatarFor, PEOPLE as MOCK_PEOPLE } from '@/data/peopleData'
import { hasConvex } from './store'
import {
  applyActionAsViewer,
  creatableUnderAsViewer,
  directoryAsViewer,
  resolveFolderProjectAsViewer,
  resolveObjectAsViewer,
  type ActResult,
} from '@/nostr/foreign'
import type { FolderProject, ForeignObject, People } from '@estiva-app/interop'

/**
 * The relay origin and the viewer's token, or null when either is missing.
 *
 * Both are required and neither is optional-with-a-fallback: without a token
 * the relay answers `403 relay_membership_required`, and without an origin
 * there is nowhere to ask. Returning null lets each caller degrade in the way
 * that suits it rather than guessing here.
 */
function useRelayViewer() {
  const config = useQuery(api.nostr.config.relayConfig, hasConvex ? {} : 'skip')
  return useCallback(() => {
    const relayUrl = config?.relayUrl
    const token = validToken()
    return relayUrl && token ? { relayUrl, token } : null
  }, [config?.relayUrl])
}

export function useForeignObjects() {
  const viewer = useRelayViewer()

  const resolveObject = useCallback(
    async (naddr: string): Promise<ForeignObject | null> => {
      const v = viewer()
      return v ? resolveObjectAsViewer(naddr, v.relayUrl, v.token) : null
    },
    [viewer],
  )

  const resolveFolderProject = useCallback(
    async (folder: string): Promise<FolderProject | null> => {
      const v = viewer()
      return v ? resolveFolderProjectAsViewer(folder, v.relayUrl, v.token) : null
    },
    [viewer],
  )

  const applyAction = useCallback(
    async (args: {
      naddr: string
      actionId: string
      /** `{ property: value }` for an object-creating action (PRO-4). */
      value: string | Record<string, string>
    }): Promise<ActResult & { created?: string }> => {
      const v = viewer()
      if (!v) return { ok: false, reason: 'Sign in to change another app’s object.' }
      return applyActionAsViewer(args, v.relayUrl, v.token)
    },
    [viewer],
  )

  /** See `creatableUnderAsViewer`. Null when signed out, as everything here is. */
  const creatableUnder = useCallback(
    async (parentKind: number) => {
      const v = viewer()
      return v ? creatableUnderAsViewer(parentKind, v.relayUrl, v.token) : null
    },
    [viewer],
  )

  return { resolveObject, resolveFolderProject, applyAction, creatableUnder }
}

/**
 * The demo dataset as a People map. Pseudo-keys, clearly marked: demo mode has
 * no relay and no pubkeys, and an action applied against one of these fails at
 * the sign-in gate long before the value could matter.
 */
const DEMO_DIRECTORY: People = Object.fromEntries(
  MOCK_PEOPLE.map((person) => [
    `demo:${person.id}`,
    { displayName: person.name, picture: avatarFor(person.name) },
  ]),
)

/** One fetch per minute, shared by every picker on screen. */
let directoryCache: { at: number; people: People } | null = null

/**
 * Everyone with a published profile — the assignee picker's list (PEE-1).
 *
 * `undefined` while loading; demo mode answers immediately from the mock
 * dataset so Storybook and no-backend checkouts render a working picker.
 */
export function useWorkspaceDirectory(): People | undefined {
  const viewer = useRelayViewer()
  const [people, setPeople] = useState<People | undefined>(() =>
    hasConvex ? directoryCache?.people : DEMO_DIRECTORY,
  )

  useEffect(() => {
    if (!hasConvex || people !== undefined) return
    let cancelled = false
    const cached = directoryCache
    // A fresh shared cache is adopted asynchronously — setState stays out of
    // the effect body — and the fetch is skipped for a minute across every
    // picker on screen.
    const source =
      cached && Date.now() - cached.at < 60_000
        ? Promise.resolve(cached.people)
        : (() => {
            const v = viewer()
            if (!v) return null
            return directoryAsViewer(v.relayUrl, v.token).then((result) => {
              directoryCache = { at: Date.now(), people: result }
              return result
            })
          })()
    // A failed read leaves the picker with Unassigned plus whoever the
    // object itself names — degraded, never broken.
    source?.then((result) => !cancelled && setPeople(result)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [viewer, people])

  return people
}
