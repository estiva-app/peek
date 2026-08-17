/**
 * Seam-internal runtime stores.
 *
 * `PeekDataProvider` is the single provider the app (and story decorators)
 * mount; it composes the runtime override stores. These are permanent
 * dual-role infrastructure (Phase 2 close-out ruling): without a Convex
 * deployment they are the full source of truth over the static mocks
 * (tests, Storybook, demo instance); with one they cover only the
 * optimistic window until the reactive queries catch up.
 *   - StarredProvider        (stars)
 *   - TopicStoreProvider     (runtime topics + DM-promoted huddles)
 *   - TopicMutationsProvider (the message/reply/huddle override layers)
 *   - DmRuntimeProvider      (DM sent messages — lifted here from
 *     useDmConversationView's hook-local state so DM sends survive
 *     navigation, matching topic behavior and the future backend)
 *
 * Nothing outside src/api may import the underlying providers directly.
 */
import { createContext, useContext, useState, useMemo, type ReactNode, type Dispatch, type SetStateAction } from 'react'
import { ConvexProviderWithAuth, ConvexReactClient } from 'convex/react'
import { hasEstivaIdSession } from '@/auth/estivaId'
import { useEstivaIdAuth } from '@/auth/useEstivaIdAuth'
import { StarredProvider } from '@/api/internal/starred'
import { TopicStoreProvider } from '@/api/internal/topicStore'
import { TopicMutationsProvider } from '@/api/internal/topicMutations'
import { OpenWorkProvider } from '@/api/internal/openWork'
import { AvatarRegistryProvider } from './avatars'
import { MentionDirectorySync, TopicDirectorySync } from './mentions'
import type { ConversationData } from './types'

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

interface DmRuntimeValue {
  /** Runtime-sent DM messages, keyed by dmId. */
  sentDmMessages: Record<string, ConversationData[]>
  setSentDmMessages: Dispatch<SetStateAction<Record<string, ConversationData[]>>>
}

const DmRuntimeContext = createContext<DmRuntimeValue | null>(null)

function DmRuntimeProvider({ children }: { children: ReactNode }) {
  const [sentDmMessages, setSentDmMessages] = useState<Record<string, ConversationData[]>>({})
  const value = useMemo(() => ({ sentDmMessages, setSentDmMessages }), [sentDmMessages])
  return <DmRuntimeContext.Provider value={value}>{children}</DmRuntimeContext.Provider>
}

/** Seam-internal. Components never call this. */
export function useDmRuntime(): DmRuntimeValue {
  const ctx = useContext(DmRuntimeContext)
  if (!ctx) throw new Error('useDmRuntime must be used within PeekDataProvider')
  return ctx
}

export function PeekDataProvider({ children }: { children: ReactNode }) {
  // AvatarRegistryProvider is outermost of the runtime stores: it only needs
  // the Convex queries above it, and the stores below (Starred) resolve
  // avatars through it.
  const tree = (
    <AvatarRegistryProvider>
      <MentionDirectorySync />
      <StarredProvider>
        <TopicStoreProvider>
          <TopicDirectorySync />
          <TopicMutationsProvider>
            <OpenWorkProvider>
              <DmRuntimeProvider>{children}</DmRuntimeProvider>
            </OpenWorkProvider>
          </TopicMutationsProvider>
        </TopicStoreProvider>
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
  // With Estiva ID the only sign-in, `useEstivaIdAuth` simply reports
  // unauthenticated when there is no token, which is what `AuthGate` wants
  // anyway. Mock mode never connects the client, so mounting this there is
  // harmless.
  return (
    <ConvexProviderWithAuth client={convexClient} useAuth={useEstivaIdAuth}>
      {tree}
    </ConvexProviderWithAuth>
  )
}


/** Whether a Convex deployment is wired up (drives seam-internal fallbacks). */
export const hasConvex = CONVEX_URL !== undefined

/**
 * Whether this tab is holding an Estiva ID token (PEEK-104).
 *
 * No longer a provider choice — PEEK-41 left one provider — so this now means
 * only "is there a token to sign or read with". The publish and sync paths use
 * it to skip work that would fail without one.
 *
 * Still evaluated once at module load rather than reactively. Acquiring a token
 * always ends in a full page load (see `EstivaIdCallback`), so the app remounts
 * with the answer settled, and a value that flipped mid-render would put the
 * relay paths and the auth gate briefly out of step.
 */
// A computed constant, not a component — the rule permits only literal ones.
// eslint-disable-next-line react-refresh/only-export-components
export const usesEstivaId = hasConvex && hasEstivaIdSession()
