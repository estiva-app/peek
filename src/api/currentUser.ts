/**
 * Current-user identity — the viewer is a pubkey (REM-6).
 *
 * The id is the pubkey in the Estiva ID token; the name and face are that
 * key's `kind:0`, read from the relay with the rest of the workspace. The read
 * mappers compare row author ids against `useCurrentUser().id` and render the
 * viewer's own rows as the 'You' label — components keep the label contract
 * unchanged. Mock mode keeps the prototype convention (the literal author
 * name 'You').
 *
 * Convex's `users.me` used to answer this, with a Convex id. What it held
 * beyond the relay's profile is dropped, not moved (Miky, 2026-09-23): `role`
 * was a free-text title on two users, and the relay holds no email.
 */
import { useMemo } from 'react'
import { useViewerProfile } from './people'
import { hasRelay } from './relayUrl'

/** The render-time label for the viewer's own rows. */
export const CURRENT_USER_NAME = 'You'

export function isCurrentUser(authorName: string): boolean {
  return authorName === CURRENT_USER_NAME
}

export interface CurrentUser {
  /** The viewer's pubkey; the mock cast's own id in demo mode. */
  id: string
  /** The profile's name; empty while the key has published none. */
  name: string
  /** The profile's picture; absent until the person sets one. */
  avatarUrl?: string
  /** Set only for the demo fixture's user — keeps the demo's portrait. */
  seedKey?: string
}

const MOCK_CURRENT_USER: CurrentUser = { id: 'you', name: CURRENT_USER_NAME, seedKey: 'you' }

/**
 * The signed-in user. `undefined` until the relay's first answer lands —
 * the seam's read hooks treat that as loading.
 */
export function useCurrentUser(): CurrentUser | undefined {
  const viewer = useViewerProfile()
  return useMemo(() => {
    if (!hasRelay) return MOCK_CURRENT_USER
    if (!viewer) return undefined
    return {
      id: viewer.pubkey,
      name: viewer.profile?.name ?? '',
      ...(viewer.profile?.picture ? { avatarUrl: viewer.profile.picture } : {}),
    }
  }, [viewer])
}
