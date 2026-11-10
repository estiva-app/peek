/**
 * Avatar resolution — one lookup for the whole app.
 *
 * Precedence: the picture in the person's profile (`kind:0`, on the relay —
 * REM-6) wins; otherwise the seeded demo portrait for that name (keeps the demo
 * dataset pixel-identical); otherwise nothing, and `Avatar` draws the
 * silhouette.
 *
 * It is a context with a MOCK DEFAULT rather than a required provider, so
 * `Avatar` stays a dumb primitive: Storybook and unit tests render it with
 * no provider and still get the mock portraits, exactly as before.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { avatarFor } from '@/data/peopleData'
import { CURRENT_USER_NAME, useCurrentUser } from './currentUser'
import { useWorkspaceProfiles } from './people'
import { hasRelay } from './relayUrl'

export type AvatarLookup = (name: string | undefined) => string | undefined

/** No provider (Storybook, tests) → the static name-keyed mock portraits. */
const AvatarContext = createContext<AvatarLookup>(avatarFor)

/**
 * Gives every part below it each person's picture, by name: the one they
 * uploaded, else a sample portrait. Mounted by PeekDataProvider.
 */
export function AvatarRegistryProvider({ children }: { children: ReactNode }) {
  const me = useCurrentUser()
  const profiles = useWorkspaceProfiles()

  const lookup = useMemo<AvatarLookup>(() => {
    if (!hasRelay) return avatarFor
    const byName = new Map((profiles ?? []).map((p) => [p.name, p.picture]))
    return (name) => {
      if (!name) return undefined
      if (name === CURRENT_USER_NAME) {
        // The viewer. A real sign-up with no upload gets the silhouette —
        // never the demo fixture's portrait; the seed user keeps hers.
        return me?.avatarUrl ?? (me?.seedKey === 'you' ? avatarFor(CURRENT_USER_NAME) : undefined)
      }
      return byName.get(name) ?? avatarFor(name)
    }
  }, [me, profiles])

  return <AvatarContext.Provider value={lookup}>{children}</AvatarContext.Provider>
}

/** Resolve an author/person name to an avatar URL. */
export function useAvatarSrc(): AvatarLookup {
  return useContext(AvatarContext)
}
