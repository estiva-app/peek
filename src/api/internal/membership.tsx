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
 * uuid. A file's membership is the fold over its events. A Folder has nothing
 * to read (Miky, 2026-10-01), so nobody is a member of its own chat and it
 * lights only for a message that names the viewer. `termsOf` answers both the
 * same way for a judge: member or not, since when, muted or not.
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
  /** Whether the viewer is a member of a file. For a control; a gate reads `termsOf`. */
  isMember: (key: string) => boolean
  termsOf: (key: string) => StreamTerms
  /** Whether a message's content names the viewer: it counts through a mute (§11.8). */
  isMentioned: (messageId: string) => boolean
  /** Whether a message names the viewer urgently (SPEC §13.1, CON-17) — Desk's Urgent for a file. */
  isUrgent: (messageId: string) => boolean
  /** File addresses the viewer is a member of — what the Screener asks the relay about. */
  memberFiles: readonly string[]
  /** Join or leave a file; local at once, then published. */
  /** Resolves true once the relay holds the change; false when nothing changed (no seam, no answer yet, no Folder) or the relay refused it. */
  setMember: (file: string, folder: string, member: boolean) => Promise<boolean>
  /** Re-read the relay, e.g. after the viewer wrote in a file. */
  refresh: () => Promise<void>
}

const NOT_A_MEMBER: StreamTerms = { member: false, muted: false }

const INERT: MembershipSeam = {
  state: 'unknown',
  me: undefined,
  isMember: () => false,
  termsOf: () => NOT_A_MEMBER,
  isMentioned: () => false,
  isUrgent: () => false,
  memberFiles: [],
  setMember: async () => false,
  refresh: async () => {},
}

const MembershipContext = createContext<MembershipSeam | null>(null)

/*
  `validToken()` is null during every silent renewal (PEEK-108). A render in
  that window must not read the viewer as nobody, or every dot goes out and
  comes back: the last pubkey seen stands until a token says otherwise.
*/
let lastPubkey: string | undefined
function viewerPubkey(): string | undefined {
  const pubkey = validToken()?.pubkey
  if (pubkey) lastPubkey = pubkey
  return lastPubkey
}

export function MembershipProvider({ children }: { children: ReactNode }) {
  // Where the relay lives: a build-time value since REM-2, so membership works
  // with Convex unreachable.
  const sync = useMembershipSync(RELAY_URL)
  const me = viewerPubkey()

  const termsOf = useCallback(
    (key: string): StreamTerms => {
      const muted = sync.muted.has(key)
      // A Folder has nothing to read (Miky, 2026-10-01): its own chat is a stream nobody is a member of, so it lights only for a message that names the viewer.
      if (fileContext(key) === undefined) return { member: false, muted }
      const folded = sync.files.get(key)
      if (folded) return { member: folded.member, since: folded.since, muted }
      // A file the viewer created is theirs unless a leave of theirs says otherwise, and a leave is among the files read.
      if (me && authorOfAddress(key) === me) return { member: true, since: sync.floor, muted }
      return { member: false, muted }
    },
    [sync.files, sync.muted, sync.floor, me],
  )
  const isMentioned = useCallback((id: string) => sync.mentioned.has(id), [sync.mentioned])
  const isUrgent = useCallback((id: string) => sync.urgent.has(id), [sync.urgent])
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
      termsOf,
      isMentioned,
      isUrgent,
      memberFiles,
      setMember: sync.setMember,
      refresh: sync.refresh,
    }),
    [sync.state, sync.setMember, sync.refresh, me, termsOf, isMentioned, isUrgent, memberFiles],
  )
  return <MembershipContext.Provider value={value}>{children}</MembershipContext.Provider>
}

export function useMembership(): MembershipSeam {
  return useContext(MembershipContext) ?? INERT
}
