/**
 * Avatar resolution — one lookup for the whole app.
 *
 * Precedence: an uploaded avatar (Convex file storage) wins; otherwise the
 * seeded demo portrait for that name (keeps the demo dataset
 * pixel-identical); otherwise nothing, and `Avatar` draws the silhouette.
 *
 * It is a context with a MOCK DEFAULT rather than a required provider, so
 * `Avatar` stays a dumb primitive: Storybook and unit tests render it with
 * no provider and still get the mock portraits, exactly as before.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { avatarFor } from '@/data/peopleData'
import { CURRENT_USER_NAME, useCurrentUser } from './currentUser'
import { usePeople } from './people'
import { hasConvex } from './store'

export type AvatarLookup = (name: string | undefined) => string | undefined

/** No provider (Storybook, tests) → the static name-keyed mock portraits. */
const AvatarContext = createContext<AvatarLookup>(avatarFor)

/**
 * Gives every part below it each person's picture, by name: the one they
 * uploaded, else a sample portrait. Mounted by PeekDataProvider.
 */
export function AvatarRegistryProvider({ children }: { children: ReactNode }) {
  const me = useCurrentUser()
  const people = usePeople()

  const lookup = useMemo<AvatarLookup>(() => {
    if (!hasConvex) return avatarFor
    const byName = new Map((people ?? []).map((p) => [p.name, p.avatarSrc]))
    return (name) => {
      if (!name) return undefined
      if (name === CURRENT_USER_NAME) {
        // The viewer. A real sign-up with no upload gets the silhouette —
        // never the demo fixture's portrait; the seed user keeps hers.
        return me?.avatarUrl ?? (me?.seedKey === 'you' ? avatarFor(CURRENT_USER_NAME) : undefined)
      }
      return byName.get(name) ?? avatarFor(name)
    }
  }, [me, people])

  return <AvatarContext.Provider value={lookup}>{children}</AvatarContext.Provider>
}

/** Resolve an author/person name to an avatar URL. */
export function useAvatarSrc(): AvatarLookup {
  return useContext(AvatarContext)
}
