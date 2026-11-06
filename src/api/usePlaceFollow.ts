import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { placeListing, switchStateOf, type Listed, type Place, type SwitchChoice, type SwitchState } from '@estiva-app/conversation'
import { heldToken } from '@/auth/heldSession'
import { readPlaceAsViewer, type PlaceRead } from '@/nostr/places'
import type { TeamWrite } from '@/nostr/teams'
import { usePeekActions } from './actions'
import { useMembership } from './internal/membership'
import { RELAY_URL } from './relayUrl'

/** The place a header follows: a topic or space by its address and team, or a team's chat. */
export interface FollowTarget {
  place: Place
  /** The place's own Folder: its root's `h`, or the team itself for its chat. What its changes are filed in. */
  folder: string
  /** Its team is archived: the switch shows Not following and cannot be changed (§3.2). */
  archived: boolean
}

export interface PlaceFollow {
  /** What the switch shows; undefined until the place has been read. */
  state: SwitchState | undefined
  /** Who it lists, All first; undefined until read. */
  listed: readonly Listed[] | undefined
  /** The read failed: no switch, rather than a guess. */
  failed: boolean
  /** One pick on the switch; resolves once the relay holds it and the place was read again. */
  choose: (choice: SwitchChoice) => Promise<TeamWrite>
  /** Add these people at Important; resolves once every one is held, or on the first refusal. */
  add: (people: readonly string[]) => Promise<TeamWrite>
}

/**
 * How the viewer follows one place, who it lists, and the writes that change
 * them (TEA-6, SPEC §11.8): one read of the place when its header opens, and
 * again after each of the viewer's own writes. The rules are
 * `@estiva-app/conversation`'s — `switchStateOf`, `placeListing`,
 * `switchWrites`, `buildPlaceAdd` — so Ship says and writes the same.
 *
 * Load cost: one `POST /query` per opened place (its changes, its team's
 * roster and list, the commands naming it, the viewer's teams list).
 */
export function usePlaceFollow(target: FollowTarget | undefined): PlaceFollow {
  const membership = useMembership()
  const { choosePlaceLevel, addToPlace } = usePeekActions()
  const key = target ? `${target.place.address}|${target.place.team}|${target.folder}` : ''
  const [held, setHeld] = useState<{ key: string; read?: PlaceRead; failed: boolean }>({ key: '', failed: false })
  const started = useRef(0)

  const load = useCallback(async () => {
    const token = heldToken()
    if (!target || !RELAY_URL || !token) return
    const mine = ++started.current
    try {
      const read = await readPlaceAsViewer(target.place, RELAY_URL, token)
      if (mine === started.current) setHeld({ key, read, failed: false })
    } catch (error) {
      console.warn('[places] could not read the place:', error)
      if (mine === started.current) setHeld((now) => ({ key, read: now.key === key ? now.read : undefined, failed: now.key !== key || !now.read }))
    }
    // `target` is identified by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    void load()
  }, [load])

  const me = membership.me
  const muted = target ? membership.termsOf(target.place.address).muted : false
  const read = held.key === key ? held.read : undefined
  const archived = target?.archived ?? false

  const state = useMemo(() => {
    if (!target || !read || !me) return undefined
    return switchStateOf(target.place, me, { ...read.facts, archived }, { muted })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, me, muted, archived, key])

  const listed = useMemo(() => {
    if (!target || !read) return undefined
    const { teams, ...facts } = read.facts
    return placeListing(target.place, { ...facts, archived }, me ? { pubkey: me, ...(teams ? { teams } : {}) } : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, me, archived, key])

  const choose = useCallback(
    async (choice: SwitchChoice): Promise<TeamWrite> => {
      if (!target || !read) return { ok: false, reason: 'Peek has not read this yet. Try again.' }
      const result = await choosePlaceLevel({ place: target.place, folder: target.folder, choice, read, archived, muted })
      // The dots follow the new level: the membership read holds the viewer's changes and mutes.
      await Promise.all([load(), membership.refresh()])
      return result
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, read, archived, muted, load, membership.refresh, choosePlaceLevel],
  )

  const add = useCallback(
    async (people: readonly string[]): Promise<TeamWrite> => {
      if (!target || !read) return { ok: false, reason: 'Peek has not read this yet. Try again.' }
      let result: TeamWrite = { ok: true }
      for (const person of people) {
        result = await addToPlace({ place: target.place, folder: target.folder, person, read })
        if (!result.ok) break
      }
      await load()
      return result
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, read, load, addToPlace],
  )

  return { state, listed, failed: held.key === key && held.failed, choose, add }
}
