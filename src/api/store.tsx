/**
 * Seam-internal runtime stores.
 *
 * `PeekDataProvider` is the single provider the app (and story decorators)
 * mount; it composes the runtime override stores. These are permanent
 * dual-role infrastructure (Phase 2 close-out ruling): without a Convex
 * deployment they are the full source of truth over the static mocks
 * (tests, Storybook, demo instance); with one they cover only the
 * optimistic window until the reactive queries catch up.
 *   - TopicStoreProvider     (runtime topics + DM-promoted huddles)
 *   - StarredProvider        (stars; inside TopicStoreProvider — see below)
 *   - TopicMutationsProvider (the message/reply/huddle override layers)
 *
 * DMs have no store here since REM-1: a DM is read from its channel on the
 * relay, and nothing is held between a send and the re-read.
 *
 * Nothing outside src/api may import the underlying providers directly.
 */
import type { ReactNode } from 'react'
import { ConvexProvider, ConvexProviderWithAuth, ConvexReactClient } from 'convex/react'
import { EstivaIdSessionProvider } from '@/auth/EstivaIdSession'
import { useEstivaIdSession } from '@/auth/useEstivaIdSession'
import { StarredProvider } from '@/api/internal/starred'
import { ReadStateSync } from '@/nostr/useReadStateSync'
import { TopicStoreProvider } from '@/api/internal/topicStore'
import { TopicMutationsProvider } from '@/api/internal/topicMutations'
import { OpenWorkProvider } from '@/api/internal/openWork'
import { ScreenerProvider } from '@/api/internal/screener'
import { DmVisibilityProvider } from '@/api/internal/dmVisibility'
import { FollowsProvider } from '@/api/internal/follows'
import { AvatarRegistryProvider } from './avatars'
import { MentionDirectorySync, TopicDirectorySync } from './mentions'

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
 * Mounts every store Peek's pages read from — people's pictures, topics,
 * starred, read state and the rest — once, in the order they depend on each other.
 */
export function PeekDataProvider({ children }: { children: ReactNode }) {
  // AvatarRegistryProvider is outermost of the runtime stores: it only needs
  // the Convex queries above it, and the stores below resolve avatars through
  // it.
  //
  // StarredProvider sits **inside** TopicStoreProvider, and did not used to
  // (SHR-6). Its set now comes from the relay as bare ids, so it resolves them
  // to rows through `useTopics()` — and that reads the runtime topic store, for
  // the optimistic window on a rename or a delete. Mounted above it, the
  // provider throws on first render.
  const tree = (
    <AvatarRegistryProvider>
      <MentionDirectorySync />
      <ReadStateSync />
      <TopicStoreProvider>
        <TopicDirectorySync />
        <StarredProvider>
          <TopicMutationsProvider>
            {/* The followed set (FOL-30): the relay's blob alone, read by the
                unread hooks and the follow controls. Reads no store above it,
                and sits above the Screener, whose file half is judged over it
                (FOL-34). */}
            <FollowsProvider>
              {/* Inside OpenWorkProvider: the Screener's PEE-6 de-duplication
                  reads the open-work list, so open work has to be above it. */}
              <OpenWorkProvider>
                <ScreenerProvider>
                  {/* Hidden DMs (DMS-6): the relay's set, joined to rows through Convex.
                      It reads nothing from the stores above, so it sits innermost. */}
                  <DmVisibilityProvider>{children}</DmVisibilityProvider>
                </ScreenerProvider>
              </OpenWorkProvider>
            </FollowsProvider>
          </TopicMutationsProvider>
        </StarredProvider>
      </TopicStoreProvider>
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
