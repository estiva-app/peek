/**
 * The viewer's membership and mutes, read from the relay, and joins and leaves
 * written back (CON-19).
 *
 * What the unread dot and the Screener are judged over (SPEC §11.8): the files
 * the viewer is a member of, the messages that name them, and the private list
 * of what they muted. `membership.ts` says what is read and `mutes.ts` how the
 * list is kept; this is the hook that holds both and writes the one thing a
 * person chooses: joining or leaving a file. Muting is read-only here — Peek
 * has no control for it.
 *
 * ## `state`
 *
 * - `unknown` — not asked (no relay origin, no token in this tab) or not yet
 *   answered. A gate must judge nothing here: an empty set taken as
 *   authoritative would put out every dot until the relay answers and then
 *   light them all at once. Both reads have to land.
 * - `known` — the relay answered each. A person with no mute list is `known`.
 *
 * ## Writes are optimistic and serialized
 *
 * The local set moves the moment the person clicks, so the control and the dot
 * answer at once; the publish follows, and a refused publish puts it back.
 * Publishes are chained rather than dropped. A join or a leave is a public
 * `kind:1851` change (`buildMembershipChange`).
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
import { fetchMembership } from './membership'
import { fetchMutes } from './mutes'
import type { RelaySeam } from './stars'

export type MembershipState = 'unknown' | 'known'

export interface MembershipSync {
  state: MembershipState
  /** Every file the last read folded — members and people who left. Created files with no event are not here: ask by address. */
  files: ReadonlyMap<string, Membership>
  /** Ids of the messages that name the viewer: they count through a mute and without a membership. */
  mentioned: ReadonlySet<string>
  /** Ids of the ones among them urgent for the viewer (CON-17). */
  urgent: ReadonlySet<string>
  /** File addresses the viewer muted, elsewhere or before: read, never written here. */
  muted: ReadonlySet<string>
  /** Unix seconds a created file's membership starts at. */
  floor: number
  /** Join a file, or leave it: local at once, then published. Resolves when the relay has answered. */
  /** `true` once the relay holds the change; otherwise why nothing changed, in words a toast can show. */
  setMember: (file: string, folder: string, member: boolean) => Promise<true | string>
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
  mentioned: number
  muted: string[]
} = { state: 'unknown', files: {}, mentioned: 0, muted: [] }

/** A Folder id, as `buildMembershipChange` takes one: a lowercase UUID v4. */
const FOLDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const EMPTY_FILES: ReadonlyMap<string, Membership> = new Map()
const EMPTY_SET: ReadonlySet<string> = new Set()

export function useMembershipSync(relayUrl: string | null | undefined): MembershipSync {
  const [state, setState] = useState<MembershipState>('unknown')
  const [files, setFiles] = useState<ReadonlyMap<string, Membership>>(EMPTY_FILES)
  const [mentioned, setMentioned] = useState<ReadonlySet<string>>(EMPTY_SET)
  const [urgent, setUrgent] = useState<ReadonlySet<string>>(EMPTY_SET)
  const [muted, setMutedSet] = useState<ReadonlySet<string>>(EMPTY_SET)
  const [floor, setFloor] = useState(0)
  /** Whether each read has answered at least once — `state` leaves `unknown` only when both have. */
  const landed = useRef({ membership: false, mutes: false })
  /** Publishes in flight, chained so none is dropped and none overtakes another. */
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  /** A read that lands after a newer local change must not undo it. */
  const generation = useRef(0)
  /**
   * Local joins and leaves the relay has not been read back for: they win over a
   * read that started before they were stored. Published ones wait, with the
   * instant they were stored, until a read that began after it has landed.
   */
  const pending = useRef(new Map<string, { membership: Membership; storedAt?: number }>())

  const read = useCallback(async (): Promise<void> => {
    const seam = seamFrom(relayUrl)
    if (!seam) return
    const mine = ++generation.current
    const startedAt = Date.now()
    const [membership, mutesRead] = await Promise.all([
      fetchMembership(seam).catch((error: unknown) => {
        console.warn('[membership] could not read the files the viewer is a member of:', error)
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
    if (membership) {
      landed.current.membership = true
      // A read that began after a change was stored already holds it, and is the relay's word.
      for (const [file, p] of pending.current) if (p.storedAt !== undefined && p.storedAt < startedAt) pending.current.delete(file)
      setFiles(new Map([...membership.files, ...[...pending.current].map(([file, p]) => [file, p.membership] as const)]))
      setMentioned(membership.mentioned)
      setUrgent(membership.urgent)
      setFloor(membership.floor)
    } else console.warn('[membership] the relay did not say which files the viewer is a member of')
    if (mutesRead.state !== 'unreachable') {
      landed.current.mutes = true
      setMutedSet(new Set(mutesRead.keys))
    } else console.warn('[membership] the relay did not say what the viewer muted')
    setState(landed.current.membership && landed.current.mutes ? 'known' : 'unknown')
  }, [relayUrl])

  useEffect(() => {
    void read()
  }, [read])

  // Membership changes under the person — a mention lands, an issue is
  // assigned, they are added — so it is re-read on the same triggers the
  // listings use.
  useRefreshTriggers(() => void read(), { enabled: !!relayUrl })

  // For `window.__membership()`: what the tab holds, as of the last render.
  useEffect(() => {
    lastSnapshot = {
      state,
      files: Object.fromEntries(
        [...files]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([key, m]) => [key, { member: m.member, ...(m.since !== undefined ? { since: new Date(m.since * 1000).toISOString() } : {}) }]),
      ),
      mentioned: mentioned.size,
      muted: [...muted].sort(),
    }
  }, [state, files, mentioned, muted])

  const setMember = useCallback(
    async (file: string, folder: string, member: boolean) => {
      const seam = seamFrom(relayUrl)
      if (!seam) {
        console.warn('[membership] not changed: no relay origin or no live Estiva ID token in this tab')
        return 'You are not signed in to the relay in this tab.'
      }
      if (state === 'unknown') {
        console.warn('[membership] not changed: the relay has not said what the viewer is a member of')
        return 'Peek has not read what you are a member of yet.'
      }
      if (!FOLDER_ID.test(folder)) {
        // `buildMembershipChange` would throw; say so now rather than flipping the control and flipping it back.
        console.warn('[membership] not changed: the file has no Folder to name in the change:', folder)
        return 'This file is in no Folder Peek can name.'
      }
      generation.current++
      const before = files.get(file)
      const now = Date.now()
      const local: Membership = member ? { member: true, since: Math.floor(now / 1000) } : { member: false }
      pending.current.set(file, { membership: local })
      setFiles((prev) => new Map(prev).set(file, local))

      const run = async (): Promise<true | string> => {
        let why = 'It could not be sent. Try again.'
        try {
          const unsigned = buildMembershipChange(seam.pubkey, now, { file, folder, person: seam.pubkey, member })
          const signed: SignedEvent = await signViaEstivaId(unsigned, seam.accessToken, seam.pubkey)
          const result = await publishSigned(seam.relayUrl, signed, seam.accessToken, seam.pubkey)
          if (result.ok) {
            const held = pending.current.get(file)
            if (held) held.storedAt = Date.now()
            return true
          }
          console.warn('[membership] publish failed:', result.reason)
          // The relay's own words stay in the console (above); the toast says it plainly.
          why = 'The relay said no. Try again.'
        } catch (error) {
          console.warn('[membership] publish threw:', error)
          why = 'It could not be sent. Try again.'
        }
        // Refused: the control said something the relay does not hold. Undo this change alone.
        pending.current.delete(file)
        setFiles((prev) => {
          const next = new Map(prev)
          if (before) next.set(file, before)
          else next.delete(file)
          return next
        })
        return why
      }
      // One change at a time, in order; this call's own answer is what it returns.
      const mine = chain.current.then(run, run)
      chain.current = mine
      return mine
    },
    [relayUrl, state, files],
  )

  return { state, files, mentioned, urgent, muted, floor, setMember, refresh: read }
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
