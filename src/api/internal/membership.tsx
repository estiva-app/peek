/**
 * What the viewer is told about — the one seam the unread dots are judged over
 * (SPEC §11.8, CON-19). It replaces following (FOL-30).
 *
 * The relay is the source (`useMembershipSync`); this is the seam the app reads
 * it through, so a row, a page header and both unread hooks agree on it, and a
 * change in one place moves the others in the same render. Nothing is seeded
 * from Convex and nothing is written there.
 *
 * ## Keys
 *
 * A **file** is a key by its address; a **Folder's general stream** by its
 * uuid. A file's membership is the fold over its events, and a Folder's is the
 * roster, so `termsOf` answers both the same way for a judge: member or not,
 * since when, muted or not.
 *
 * ## Read it, do not interpret `unknown`
 *
 * While `state` is `unknown` every answer is "not a member", which is right
 * for a control and wrong for a gate: the unread hooks must read `state` and
 * judge nothing before it leaves `unknown`, or every dot goes out on load and
 * comes back a second later.
 *
 * ## Outside the provider
 *
 * A story or a test that mounts a row without `PeekDataProvider` gets an inert
 * value — `unknown`, nobody a member, controls that do nothing — rather than a
 * throw, so the rows can be drawn on their own.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { fileContext } from '@estiva-app/conversation'
import { validToken } from '@/auth/estivaId'
import type { StreamTerms } from '@/api/streamUnread'
import { authorOfAddress } from '@/nostr/membership'
import { type MembershipState, useMembershipSync } from '@/nostr/useMembershipSync'
import { RELAY_URL } from '@/api/relayUrl'

export interface MembershipSeam {
  state: MembershipState
  /** The viewer's pubkey, or undefined with no live token. */
  me: string | undefined
  /** Whether the viewer is a member of a file, or on a Folder's roster. For a control; a gate reads `termsOf`. */
  isMember: (key: string) => boolean
  isMuted: (key: string) => boolean
  termsOf: (key: string) => StreamTerms
  /** Whether a message's content names the viewer: it counts through a mute (§11.8). */
  isMentioned: (messageId: string) => boolean
  /** File addresses the viewer is a member of — what the Screener asks the relay about. */
  memberFiles: readonly string[]
  /** Join or leave a file; local at once, then published. */
  setMember: (file: string, folder: string, member: boolean) => Promise<void>
  /** Mute or unmute a file or a Folder's general stream; local at once, then published. */
  setMuted: (key: string, on: boolean) => Promise<void>
  /** Re-read the relay, e.g. after the viewer wrote in a file. */
  refresh: () => Promise<void>
}

const NOT_A_MEMBER: StreamTerms = { member: false, muted: false }

const INERT: MembershipSeam = {
  state: 'unknown',
  me: undefined,
  isMember: () => false,
  isMuted: () => false,
  termsOf: () => NOT_A_MEMBER,
  isMentioned: () => false,
  memberFiles: [],
  setMember: async () => {},
  setMuted: async () => {},
  refresh: async () => {},
}

const MembershipContext = createContext<MembershipSeam | null>(null)

export function MembershipProvider({ children }: { children: ReactNode }) {
  // Where the relay lives: a build-time value since REM-2, so membership works
  // with Convex unreachable.
  const sync = useMembershipSync(RELAY_URL)
  const me = validToken()?.pubkey

  const termsOf = useCallback(
    (key: string): StreamTerms => {
      const muted = sync.muted.has(key)
      if (fileContext(key) === undefined) return { member: sync.roster.has(key), muted }
      const folded = sync.files.get(key)
      if (folded) return { member: folded.member, since: folded.since, muted }
      // A file the viewer created is theirs unless a leave of theirs says otherwise, and a leave is among the files read.
      if (me && authorOfAddress(key) === me) return { member: true, since: sync.floor, muted }
      return { member: false, muted }
    },
    [sync.files, sync.roster, sync.muted, sync.floor, me],
  )
  const isMentioned = useCallback((id: string) => sync.mentioned.has(id), [sync.mentioned])
  const memberFiles = useMemo(
    () =>
      [...sync.files]
        .filter(([, membership]) => membership.member)
        .map(([file]) => file)
        .sort(),
    [sync.files],
  )

  const value = useMemo<MembershipSeam>(
    () => ({
      state: sync.state,
      me,
      isMember: (key) => termsOf(key).member,
      isMuted: (key) => sync.muted.has(key),
      termsOf,
      isMentioned,
      memberFiles,
      setMember: sync.setMember,
      setMuted: sync.setMuted,
      refresh: sync.refresh,
    }),
    [sync.state, sync.muted, sync.setMember, sync.setMuted, sync.refresh, me, termsOf, isMentioned, memberFiles],
  )
  return <MembershipContext.Provider value={value}>{children}</MembershipContext.Provider>
}

export function useMembership(): MembershipSeam {
  return useContext(MembershipContext) ?? INERT
}
