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
 * topics in FOL-23, and the Convex client itself in REM-7.
 *
 * Nothing outside src/api may import the underlying providers directly.
 */
import type { ReactNode } from 'react'
import { EstivaIdSessionProvider } from '@/auth/EstivaIdSession'
import { StarredProvider } from '@/api/internal/starred'
import { ReadStateSync } from '@/nostr/useReadStateSync'
import { OpenWorkProvider } from '@/api/internal/openWork'
import { ScreenerProvider } from '@/api/internal/screener'
import { DmsProvider } from '@/api/internal/dms'
import { FollowsProvider } from '@/api/internal/follows'
import { AvatarRegistryProvider } from './avatars'
import { MentionDirectorySync } from './mentions'

/**
 * Mounts every store Peek's pages read from — people's pictures, starred, read
 * state and the rest — once, in the order they depend on each other.
 *
 * The Estiva ID session is outermost: `AuthGate` reads it to decide signed in
 * or out, and there must be exactly one (`EstivaIdSessionProvider` says why).
 */
export function PeekDataProvider({ children }: { children: ReactNode }) {
  // AvatarRegistryProvider is outermost of the runtime stores: the stores below
  // resolve avatars through it.
  return (
    <EstivaIdSessionProvider>
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
    </EstivaIdSessionProvider>
  )
}
