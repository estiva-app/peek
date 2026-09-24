/**
 * Who is in the workspace, from the relay: the roster, named by profiles (REM-3).
 *
 * Two relay facts, one request:
 *
 * - **`kind:13534`** — the relay's own NIP-43 membership list, relay-signed,
 *   one `member` tag per admitted pubkey. It is who belongs here; Convex's
 *   `users` table was a copy of who had signed in to Peek.
 * - **`kind:0`** — each member's profile, published by Estiva ID: the name and
 *   picture a row draws.
 *
 * ## Humans only
 *
 * People is where you open a conversation with a colleague, so an agent's
 * service identity does not belong on it (Miky, 2026-09-24). The marker is
 * NIP-24's `"bot": true` in the profile, which Estiva ID sets for a `role`
 * account — the one place that knows which identities are people, saying so in
 * the protocol every app reads rather than in a list only Peek keeps.
 *
 * A member with no profile is left out: there is nothing to call them, and a
 * key is not a name. So is the viewer — you do not DM yourself.
 */
import type { SignedEvent } from '@estiva-app/protocol'

/** NIP-43's relay membership list. */
export const KIND_MEMBERSHIP_LIST = 13534

export interface WorkspacePerson {
  pubkey: string
  name: string
  picture?: string
}

/** The roster and every profile, in one request. */
export function workspaceFilters(): Record<string, unknown>[] {
  return [
    { kinds: [KIND_MEMBERSHIP_LIST], limit: 1 },
    { kinds: [0], limit: 500 },
  ]
}

interface ProfileContent {
  display_name?: unknown
  name?: unknown
  picture?: unknown
  bot?: unknown
}

/**
 * The people a viewer can DM, sorted by name.
 *
 * `include` adds anyone the viewer already has a DM with who is no longer on
 * the roster: a colleague who left keeps their conversation reachable. With no
 * roster at all (a relay that keeps none), every profile is a member.
 */
export function workspacePeopleOf(
  events: readonly SignedEvent[],
  me: string | undefined,
  include: Iterable<string> = [],
): WorkspacePerson[] {
  const roster = events
    .filter((e) => e.kind === KIND_MEMBERSHIP_LIST)
    .sort((a, b) => b.created_at - a.created_at)[0]
  const members = roster
    ? new Set([
        ...roster.tags.filter((t) => (t[0] === 'member' || t[0] === 'p') && typeof t[1] === 'string').map((t) => t[1]),
        ...include,
      ])
    : null

  const newest = new Map<string, SignedEvent>()
  for (const e of events) {
    if (e.kind !== 0) continue
    const seen = newest.get(e.pubkey)
    if (!seen || e.created_at > seen.created_at) newest.set(e.pubkey, e)
  }

  const out: WorkspacePerson[] = []
  for (const [pubkey, event] of newest) {
    if (pubkey === me) continue
    if (members && !members.has(pubkey)) continue
    let content: ProfileContent
    try {
      content = JSON.parse(event.content) as ProfileContent
    } catch {
      continue
    }
    if (content.bot === true) continue
    const name = [content.display_name, content.name].find((n): n is string => typeof n === 'string' && n.trim() !== '')
    if (!name) continue
    out.push({ pubkey, name, ...(typeof content.picture === 'string' && content.picture ? { picture: content.picture } : {}) })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}
