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
import { useCallback } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { validToken } from '@/auth/estivaId'
import { hasConvex } from './store'
import {
  applyActionAsViewer,
  resolveFolderProjectAsViewer,
  resolveObjectAsViewer,
  type ActResult,
} from '@/nostr/foreign'
import type { FolderProject, ForeignObject } from '@estiva-app/interop'

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
    async (args: { naddr: string; actionId: string; value: string }): Promise<ActResult> => {
      const v = viewer()
      if (!v) return { ok: false, reason: 'Sign in to change another app’s object.' }
      return applyActionAsViewer(args, v.relayUrl, v.token)
    },
    [viewer],
  )

  return { resolveObject, resolveFolderProject, applyAction }
}
