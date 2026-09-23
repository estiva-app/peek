/**
 * What the viewer follows — the one set the unread dots are judged over (FOL-30).
 *
 * The relay is the set (`useFollowsSync`); this is the seam the app reads it
 * through, so a row, a page header and both unread hooks agree on it, and a
 * toggle in one place moves the others in the same render. Nothing is seeded
 * from Convex and nothing is written there: this list never had a Convex copy.
 *
 * ## Read it, do not interpret `unknown`
 *
 * `isFollowed` answers false while the relay has not spoken, which is right for
 * a *control* — an unfollowed-looking button that will follow on click. It is
 * wrong for a *gate*: the unread hooks must not treat "not yet known" as "not
 * followed", or every dot goes out on load and comes back a second later. They
 * read `state` and judge nothing before it leaves `unknown`.
 *
 * ## Outside the provider
 *
 * A story or a test that mounts a row without `PeekDataProvider` gets an inert
 * value — `unknown`, nothing followed, a toggle that does nothing — rather than
 * a throw, so the rows can be drawn on their own.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { type FollowsState, useFollowsSync } from '@/nostr/useFollowsSync'
import { RELAY_URL } from '@/api/relayUrl'

export interface Follows {
  state: FollowsState
  /** Followed keys — file addresses and Folder uuids. Empty until `state` leaves `unknown`. */
  followed: ReadonlySet<string>
  /** For a control. False while `state` is `unknown`; a gate reads `state` instead. */
  isFollowed: (key: string) => boolean
  /** Follow or unfollow one key; local at once, then published. */
  setFollowed: (key: string, on: boolean) => Promise<void>
}

const INERT: Follows = {
  state: 'unknown',
  followed: new Set(),
  isFollowed: () => false,
  setFollowed: async () => {},
}

const FollowsContext = createContext<Follows | null>(null)

export function FollowsProvider({ children }: { children: ReactNode }) {
  // Where the relay lives: a build-time value since REM-2, so following works
  // with Convex unreachable.
  const sync = useFollowsSync(RELAY_URL)
  const isFollowed = useCallback((key: string) => sync.followed.has(key), [sync.followed])
  const value = useMemo<Follows>(
    () => ({ state: sync.state, followed: sync.followed, isFollowed, setFollowed: sync.setFollowed }),
    [sync.state, sync.followed, isFollowed, sync.setFollowed],
  )
  return <FollowsContext.Provider value={value}>{children}</FollowsContext.Provider>
}

export function useFollows(): Follows {
  return useContext(FollowsContext) ?? INERT
}
