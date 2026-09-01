/**
 * Where a profile is edited (PEEK-42).
 *
 * Not here. Peek used to own your name, role and avatar — `updateProfile`, an
 * upload to Convex file storage, `setAvatar`, `removeAvatar` — and that made it
 * a second writer for something Estiva ID already owns. The visible symptom was
 * an avatar: a picture uploaded in Peek outranked the one Estiva ID published,
 * so the two apps showed different faces for the same person.
 *
 * Peek now reads a profile and never writes one. It arrives from the relay's
 * `kind:0`, which Estiva ID is the sole publisher of (PEEK-31).
 */
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { hasConvex } from './store'

/** Where someone goes to change any of it. */
export const PROFILE_EDIT_URL = 'https://id.estiva.app/account'

/**
 * The relay this workspace lives on — the account menu's workspace line
 * names it (2026-09-01, the shared IdentityMenu). Convex mode reads it from
 * the deployment's relay config; mock mode has no relay and the menu hides
 * the section.
 */
export function useRelayUrl(): string | undefined {
  return useQuery(api.nostr.config.relayConfig, hasConvex ? {} : 'skip')?.relayUrl
}
