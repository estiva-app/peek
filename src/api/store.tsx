/**
 * Seam-internal runtime stores.
 *
 * `PeekDataProvider` is the single provider the app (and story decorators)
 * mount; it composes the runtime stores: stars, follows, open work, the
 * Screener and DM channels.
 *
 * DMs have no message store here since REM-1: a DM is read from its channel on
 * the relay, and nothing is held between a send and the re-read. The topic
 * store and the message/reply/huddle override layers went with the Convex
 * topics in FOL-23.
 *
 * Nothing outside src/api may import the underlying providers directly.
 */
import type { ReactNode } from 'react'
import { ConvexProvider, ConvexProviderWithAuth, ConvexReactClient } from 'convex/react'
import { EstivaIdSessionProvider } from '@/auth/EstivaIdSession'
import { useEstivaIdSession } from '@/auth/useEstivaIdSession'
import { StarredProvider } from '@/api/internal/starred'
import { ReadStateSync } from '@/nostr/useReadStateSync'
import { OpenWorkProvider } from '@/api/internal/openWork'
import { ScreenerProvider } from '@/api/internal/screener'
import { DmsProvider } from '@/api/internal/dms'
import { FollowsProvider } from '@/api/internal/follows'
import { AvatarRegistryProvider } from './avatars'
import { MentionDirectorySync } from './mentions'

// Convex client — present only when a deployment is configured
// (`npx convex dev` writes VITE_CONVEX_URL to .env.local). Absent in unit
// tests and in checkouts without a deployment, where the mock-backed
// internals below serve everything, so the app works in both modes.
const CONVEX_URL =
  import.meta.env.MODE === 'test'
    ? undefined
    : (import.meta.env.VITE_CONVEX_URL as string | undefined) || undefined // '' counts as absent
// The client always exists so seam hooks can call useQuery/useMutation
// unconditionally (rules of hooks); without a deployment every query passes
// 'skip' (gated on hasConvex), so the placeholder client never connects.
const convexClient = new ConvexReactClient(CONVEX_URL ?? 'https://peek-no-deployment.convex.cloud')

/**
 * Mounts every store Peek's pages read from — people's pictures, starred, read
 * state and the rest — once, in the order they depend on each other.
 */
export function PeekDataProvider({ children }: { children: ReactNode }) {
  // AvatarRegistryProvider is outermost of the runtime stores: it only needs
  // the Convex queries above it, and the stores below resolve avatars through
  // it.
  const tree = (
    <AvatarRegistryProvider>
      <MentionDirectorySync />
      <ReadStateSync />
      <StarredProvider>
        {/* The followed set (FOL-30): the relay's blob alone, read by the
            unread hooks and the follow controls. Reads no store above it,
            and sits above the Screener, whose file half is judged over it
            (FOL-34). */}
        <FollowsProvider>
          {/* DM channels and hidden DMs (DMS-6, REM-3): the relay's, keyed by
              pubkey. It reads nothing from the stores above, and sits above
              the Screener, whose DM half folds its channels (CON-14). */}
          <DmsProvider>
            {/* Inside OpenWorkProvider: the Screener's PEE-6 de-duplication
                reads the open-work list, so open work has to be above it. */}
            <OpenWorkProvider>
              <ScreenerProvider>{children}</ScreenerProvider>
            </OpenWorkProvider>
          </DmsProvider>
        </FollowsProvider>
      </StarredProvider>
    </AvatarRegistryProvider>
  )
  // Exactly ONE provider owns the client's auth (PEEK-104). Both of these call
  // `client.setAuth` internally, so mounting both would leave two things racing
  // to define who you are.
  //
  // One provider now (PEEK-41). There used to be a choice here — Convex Auth by
  // default, `ConvexProviderWithAuth` when this tab held an Estiva ID token —
  // and the branch was delicate: `AuthGate` had to agree with it exactly, since
  // rendering Convex Auth's screen under the wrong provider made
  // `useAuthActions` return undefined and took the app down.
  //
  // With Estiva ID the only sign-in, the session simply reports
  // unauthenticated when there is no token.
  //
  // **Convex no longer decides who is signed in (REM-2).** `AuthGate` reads the
  // same Estiva ID session this hands Convex, through `EstivaIdSessionProvider`,
  // so there is one session and one renewal timer, and Convex being slow or
  // unreachable holds up only the screens that read it.
  //
  // Without a deployment the client gets no auth at all: handing it a token
  // would open a socket to the placeholder origin in a relay-only build.
  return (
    <EstivaIdSessionProvider>
      {hasConvex ? (
        <ConvexProviderWithAuth client={convexClient} useAuth={useEstivaIdSession}>
          {tree}
        </ConvexProviderWithAuth>
      ) : (
        <ConvexProvider client={convexClient}>{tree}</ConvexProvider>
      )}
    </EstivaIdSessionProvider>
  )
}


/** Whether a Convex deployment is wired up (drives seam-internal fallbacks). */
export const hasConvex = CONVEX_URL !== undefined

/**
 * `usesEstivaId` is gone (PEEK-167).
 *
 * It was a module-load snapshot of "does this tab hold a token", and it was the
 * last thing that required acquiring one to end in a full page load: the value
 * could only be right if the app remounted with the answer already settled.
 *
 * Every caller had already moved off it to `validToken()` at call time, because
 * a snapshot is wrong the moment a token is acquired or expires — see
 * `tokenForPublish` in `actions.ts`. By the time it was deleted nothing read it
 * at all, and the reload it cost was being paid for a value with no readers.
 */
