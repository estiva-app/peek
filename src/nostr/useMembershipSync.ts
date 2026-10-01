/**
 * The viewer's membership and mutes, read from the relay and written back (CON-19).
 *
 * What the unread dot and the Screener are judged over (SPEC §11.8): the files
 * the viewer is a member of, the Folders whose roster names them, the messages
 * that name them, and the private list of what they muted. `membership.ts`
 * says what is read and `mutes.ts` how the list is kept; this is the hook that
 * holds both and writes the two things a person chooses: joining or leaving a
 * file, and muting a file or a Folder.
 *
 * ## `state`
 *
 * - `unknown` — not asked (no relay origin, no token in this tab) or not yet
 *   answered. A gate must judge nothing here: an empty set taken as
 *   authoritative would put out every dot until the relay answers and then
 *   light them all at once. All three reads have to land.
 * - `known` — the relay answered each. A person with no mute list is `known`;
 *   the first mute writes it.
 *
 * ## Writes are optimistic and serialized
 *
 * The local set moves the moment the person clicks, so the control and the dot
 * answer at once; the publish follows, and a refused publish puts it back.
 * Publishes are chained rather than dropped. A join or a leave is a public
 * `kind:1851` change (`buildMembershipChange`); a mute is the whole private
 * list, last write wins.
 *
 * Nothing here signs a membership change for anything but the person's own
 * click: SPEC §11.8 *Following, retired* forbids turning the old private
 * follows into public memberships.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SignedEvent } from '@estiva-app/protocol'
import { buildMembershipChange, type Membership } from '@estiva-app/conversation'
import { validToken } from '@/auth/estivaId'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { publishSigned, signViaEstivaId } from './bridge'
import { fetchMembership, fetchRoster } from './membership'
import { fetchMutes, publishMutes } from './mutes'
import type { RelaySeam } from './stars'

export type MembershipState = 'unknown' | 'known'

export interface MembershipSync {
  state: MembershipState
  /** Every file the last read folded — members and people who left. Created files with no event are not here: ask by address. */
  files: ReadonlyMap<string, Membership>
  /** Channel uuids whose roster names the viewer. */
  roster: ReadonlySet<string>
  /** Ids of the messages that name the viewer: they count through a mute. */
  mentioned: ReadonlySet<string>
  /** File addresses and channel uuids the viewer muted. */
  muted: ReadonlySet<string>
  /** Unix seconds a created file's membership starts at. */
  floor: number
  /** Join a file, or leave it: local at once, then published. Resolves when the relay has answered. */
  setMember: (file: string, folder: string, member: boolean) => Promise<void>
  /** Mute or unmute one key: local at once, then published. */
  setMuted: (key: string, on: boolean) => Promise<void>
  /** Re-read the relay, discarding nothing that is still being published. */
  refresh: () => Promise<void>
}

function seamFrom(relayUrl: string | null | undefined): RelaySeam | null {
  if (!relayUrl) return null
  // At call time, never cached: `validToken()` is null during every silent
  // renewal, and a snapshot taken at mount goes stale (PEEK-108).
  const token = validToken()
  if (!token) return null
  return { relayUrl, accessToken: token.accessToken, pubkey: token.pubkey }
}

/** What this tab last saw, for `window.__membership()`. Module scope, like `__readState`. */
let lastSnapshot: {
  state: MembershipState
  files: Record<string, { member: boolean; since?: string }>
  roster: string[]
  mentioned: number
  muted: string[]
} = { state: 'unknown', files: {}, roster: [], mentioned: 0, muted: [] }

const EMPTY_FILES: ReadonlyMap<string, Membership> = new Map()
const EMPTY_SET: ReadonlySet<string> = new Set()

export function useMembershipSync(relayUrl: string | null | undefined): MembershipSync {
  const [state, setState] = useState<MembershipState>('unknown')
  const [files, setFiles] = useState<ReadonlyMap<string, Membership>>(EMPTY_FILES)
  const [roster, setRoster] = useState<ReadonlySet<string>>(EMPTY_SET)
  const [mentioned, setMentioned] = useState<ReadonlySet<string>>(EMPTY_SET)
  const [muted, setMutedSet] = useState<ReadonlySet<string>>(EMPTY_SET)
  const [floor, setFloor] = useState(0)
  /** Whether each read has answered at least once — `state` leaves `unknown` only when all have. */
  const landed = useRef({ membership: false, roster: false, mutes: false })
  /** The mute list as last read or written: `absent` means the next write creates it. */
  const mutes = useRef<{ keys: Set<string> }>({ keys: new Set() })
  const mutesUnreachable = useRef(true)
  /** Publishes in flight, chained so none is dropped and none overtakes another. */
  const chain = useRef<Promise<void>>(Promise.resolve())
  /** A read that lands after a newer local change must not undo it. */
  const generation = useRef(0)
  /** Local joins and leaves not yet confirmed by a read: they win over a read that started before them. */
  const pending = useRef(new Map<string, Membership>())
  /** What the sets last held, for a read that did not answer to keep. */
  const held = useRef<{
    files: ReadonlyMap<string, Membership>
    roster: ReadonlySet<string>
    mentioned: ReadonlySet<string>
    muted: ReadonlySet<string>
  }>({ files: EMPTY_FILES, roster: EMPTY_SET, mentioned: EMPTY_SET, muted: EMPTY_SET })

  const publishSnapshot = useCallback(
    (nextFiles: ReadonlyMap<string, Membership>, nextRoster: ReadonlySet<string>, nextMentioned: ReadonlySet<string>, nextMuted: ReadonlySet<string>, nextState: MembershipState) => {
      lastSnapshot = {
        state: nextState,
        files: Object.fromEntries(
          [...nextFiles].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, m]) => [key, { member: m.member, ...(m.since !== undefined ? { since: new Date(m.since * 1000).toISOString() } : {}) }]),
        ),
        roster: [...nextRoster].sort(),
        mentioned: nextMentioned.size,
        muted: [...nextMuted].sort(),
      }
    },
    [],
  )

  const read = useCallback(async (): Promise<void> => {
    const seam = seamFrom(relayUrl)
    if (!seam) return
    const mine = ++generation.current
    const [membership, rosterRead, mutesRead] = await Promise.all([
      fetchMembership(seam).catch((error: unknown) => {
        console.warn('[membership] could not read the files the viewer is a member of:', error)
        return undefined
      }),
      fetchRoster(seam).catch((error: unknown) => {
        console.warn('[membership] could not read the rosters:', error)
        return undefined
      }),
      fetchMutes(seam).catch((error: unknown) => {
        console.warn('[membership] could not read the mute list:', error)
        return { state: 'unreachable' as const }
      }),
    ])
    if (mine !== generation.current) return
    // An unreachable read stays as it was on purpose: a relay that did not
    // answer and one that has not been asked license the same thing — nothing.
    let { files: nextFiles, roster: nextRoster, mentioned: nextMentioned, muted: nextMuted } = held.current
    if (membership) {
      landed.current.membership = true
      nextFiles = new Map([...membership.files, ...pending.current])
      nextMentioned = membership.mentioned
      setFiles(nextFiles)
      setMentioned(nextMentioned)
      setFloor(membership.floor)
    } else console.warn('[membership] the relay did not say which files the viewer is a member of')
    if (rosterRead) {
      landed.current.roster = true
      nextRoster = rosterRead
      setRoster(rosterRead)
    } else console.warn('[membership] the relay did not say which Folders the viewer is on the roster of')
    if (mutesRead.state !== 'unreachable') {
      landed.current.mutes = true
      mutesUnreachable.current = false
      mutes.current = { keys: new Set(mutesRead.keys) }
      nextMuted = mutes.current.keys
      setMutedSet(nextMuted)
    } else console.warn('[membership] the relay did not say what the viewer muted')
    const nextState: MembershipState = landed.current.membership && landed.current.roster && landed.current.mutes ? 'known' : 'unknown'
    setState(nextState)
    held.current = { files: nextFiles, roster: nextRoster, mentioned: nextMentioned, muted: nextMuted }
    publishSnapshot(nextFiles, nextRoster, nextMentioned, nextMuted, nextState)
  }, [relayUrl, publishSnapshot])

  useEffect(() => {
    void read()
  }, [read])

  // Membership changes under the person — a mention lands, an issue is
  // assigned, they are added — so it is re-read on the same triggers the
  // listings use.
  useRefreshTriggers(() => void read(), { enabled: !!relayUrl })

  const setMember = useCallback(
    async (file: string, folder: string, member: boolean) => {
      const seam = seamFrom(relayUrl)
      if (!seam) {
        console.warn('[membership] not changed: no relay origin or no live Estiva ID token in this tab')
        return
      }
      if (state === 'unknown') {
        console.warn('[membership] not changed: the relay has not said what the viewer is a member of')
        return
      }
      generation.current++
      const before = files.get(file)
      const now = Date.now()
      const local: Membership = member ? { member: true, since: Math.floor(now / 1000) } : { member: false }
      pending.current.set(file, local)
      setFiles((prev) => new Map(prev).set(file, local))

      const run = async () => {
        try {
          const unsigned = buildMembershipChange(seam.pubkey, now, { file, folder, person: seam.pubkey, member })
          const signed: SignedEvent = await signViaEstivaId(unsigned, seam.accessToken, seam.pubkey)
          const result = await publishSigned(seam.relayUrl, signed, seam.accessToken, seam.pubkey)
          if (result.ok) {
            pending.current.delete(file)
            return
          }
          console.warn('[membership] publish failed:', result.reason)
        } catch (error) {
          console.warn('[membership] publish threw:', error)
        }
        // Refused: the control said something the relay does not hold. Undo this change alone.
        pending.current.delete(file)
        setFiles((prev) => {
          const next = new Map(prev)
          if (before) next.set(file, before)
          else next.delete(file)
          return next
        })
      }
      chain.current = chain.current.then(run, run)
      await chain.current
    },
    [relayUrl, state, files],
  )

  const setMuted = useCallback(
    async (key: string, on: boolean) => {
      const seam = seamFrom(relayUrl)
      if (!seam) {
        console.warn('[membership] not changed: no relay origin or no live Estiva ID token in this tab')
        return
      }
      // The load-bearing guard, as in stars: with the relay's answer unknown,
      // a publish would write this tab's guess over the person's real list.
      if (state === 'unknown' || mutesUnreachable.current) {
        console.warn('[membership] not changed: the relay has not said what the viewer muted')
        return
      }
      if (mutes.current.keys.has(key) === on) return
      generation.current++
      const before = new Set(mutes.current.keys)
      const keys = new Set(before)
      if (on) keys.add(key)
      else keys.delete(key)
      mutes.current = { keys }
      setMutedSet(keys)

      const run = async () => {
        try {
          const result = await publishMutes(mutes.current.keys, Date.now(), seam)
          if (result.ok) return
          console.warn('[membership] mute publish failed:', result.reason)
        } catch (error) {
          console.warn('[membership] mute publish threw:', error)
        }
        // Refused: undo this toggle alone — a later one in the chain is its own write.
        const reverted = new Set(mutes.current.keys)
        if (on) reverted.delete(key)
        else if (before.has(key)) reverted.add(key)
        mutes.current = { keys: reverted }
        setMutedSet(reverted)
      }
      chain.current = chain.current.then(run, run)
      await chain.current
    },
    [relayUrl, state],
  )

  return { state, files, roster, mentioned, muted, floor, setMember, setMuted, refresh: read }
}

/**
 * `window.__membership()` — what this tab believes the viewer is a member of
 * and has muted. Installed at module scope from the api barrel, as
 * `__readState` is, and not gated on a build flag for the same reason: a
 * diagnostic absent from production is never there when it is needed.
 */
export function installMembershipDiagnostic(): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>).__membership = () => ({ ...lastSnapshot })
}
