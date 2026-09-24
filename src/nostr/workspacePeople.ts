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

/** A named profile, and whether it is an agent's (NIP-24 `bot`). */
export interface WorkspaceProfile extends WorkspacePerson {
  bot: boolean
}

/**
 * Every named profile in the events, newest `kind:0` per pubkey (REM-6).
 *
 * Not narrowed to the roster, humans or anyone but the viewer: this answers
 * "what is this key called", which a mention of you, of an agent or of someone
 * who has left still needs answered. A profile with no usable name is absent —
 * a key is not a name.
 */
export function profilesOf(events: readonly SignedEvent[]): Map<string, WorkspaceProfile> {
  const newest = new Map<string, SignedEvent>()
  for (const e of events) {
    if (e.kind !== 0) continue
    const seen = newest.get(e.pubkey)
    if (!seen || e.created_at > seen.created_at) newest.set(e.pubkey, e)
  }

  const out = new Map<string, WorkspaceProfile>()
  for (const [pubkey, event] of newest) {
    let content: ProfileContent
    try {
      content = JSON.parse(event.content) as ProfileContent
    } catch {
      continue
    }
    const name = [content.display_name, content.name].find((n): n is string => typeof n === 'string' && n.trim() !== '')
    if (!name) continue
    out.set(pubkey, {
      pubkey,
      name,
      bot: content.bot === true,
      ...(typeof content.picture === 'string' && content.picture ? { picture: content.picture } : {}),
    })
  }
  return out
}

/** The newest roster's members, or `null` when the relay keeps no roster. */
export function rosterOf(events: readonly SignedEvent[]): Set<string> | null {
  const roster = events
    .filter((e) => e.kind === KIND_MEMBERSHIP_LIST)
    .sort((a, b) => b.created_at - a.created_at)[0]
  if (!roster) return null
  return new Set(roster.tags.filter((t) => (t[0] === 'member' || t[0] === 'p') && typeof t[1] === 'string').map((t) => t[1]))
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
  return membersOf(events, me, include)
    .filter((p) => !p.bot)
    .map((p) => ({ pubkey: p.pubkey, name: p.name, ...(p.picture ? { picture: p.picture } : {}) }))
}

/**
 * Everyone the viewer can @-mention or invite, sorted by name (REM-6).
 *
 * The roster as {@link workspacePeopleOf} reads it, **agents included**: you do
 * not DM an agent from People, but mentioning one is how you ask it something.
 * Still never the viewer — you do not mention yourself.
 */
export function mentionablePeopleOf(events: readonly SignedEvent[], me: string | undefined): WorkspaceProfile[] {
  return membersOf(events, me, [])
}

function membersOf(events: readonly SignedEvent[], me: string | undefined, include: Iterable<string>): WorkspaceProfile[] {
  const roster = rosterOf(events)
  const members = roster ? new Set([...roster, ...include]) : null
  return [...profilesOf(events).values()]
    .filter((p) => p.pubkey !== me && (!members || members.has(p.pubkey)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}
