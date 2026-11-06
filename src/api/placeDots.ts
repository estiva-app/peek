/**
 * A topic's or a space's dot, by the shared rule (TEA-6, SPEC §11.8 *What is
 * unread on a place*): how the viewer is in it is `followingOf`, and what
 * lights is `unreadOnPlace` at that level — at Important a new conversation,
 * and a reply in one they are in; at All every message since they chose All;
 * a mention at any level, and on a place they are not in. Ship's topic dots
 * read the same two (interop 0.87.0), so both apps light the same rows.
 *
 * Pure: what is read comes in, so the rule is tested without a relay.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-team-has-members-and-followers-and-a-place-is-followed-at-a-level.md
 */
import { followingOf, unreadOnPlace, type Following, type TeamsList } from '@estiva-app/conversation'
import { encodeNpub, type SignedEvent } from '@estiva-app/protocol'
import type { StreamMessage } from '@estiva-app/conversation'

/** What a space's team gives the fold: its roster and list, the viewer's teams list, and whether it is archived. */
export interface TeamFacts {
  team: string
  roster: readonly SignedEvent[]
  listing: readonly SignedEvent[]
  teams?: TeamsList
  archived: boolean
}

/**
 * How `me` is in a topic or a space. `changes` are the changes naming them on
 * it (the membership read's); the topic's root is stood in for by its address
 * — its author, and its Folder, where its changes are filed — dated `floor`,
 * the earliest the read can tell them about. `team`, when a team's list holds
 * it, brings that team's default to a space.
 */
export function topicFollowingOf(args: { address: string; folder: string; me: string; changes: readonly SignedEvent[]; floor: number; team?: TeamFacts }): Following {
  const [kind, author, ...rest] = args.address.split(':')
  const root = {
    id: '',
    sig: '',
    kind: Number(kind),
    pubkey: author ?? '',
    created_at: args.floor,
    content: '',
    tags: [
      ['d', rest.join(':')],
      ['h', args.folder],
    ],
  } as SignedEvent
  const team = args.team
  return followingOf({ address: args.address, team: team?.team ?? args.folder }, args.me, {
    events: [root, ...args.changes],
    ...(team ? { roster: team.roster, listing: team.listing, archived: team.archived, ...(team.teams ? { teams: team.teams } : {}) } : {}),
  })
}

/** Whether the place's stream has something new for `me` at the level they follow it at. */
export function placeHasUnread(
  messages: readonly StreamMessage[],
  judge: { context: string; me: string; following: Following; muted: boolean; merged: Readonly<Record<string, number>>; floor: number; isMentioned: (id: string) => boolean },
): boolean {
  // The messages carry no body: one that names the viewer is handed to the rule as the body it would have had.
  const named = `nostr:${encodeNpub(judge.me)}`
  const asPlace = messages.map((m) => ({
    id: m.id,
    pubkey: m.by,
    kind: 9,
    created_at: m.at,
    content: judge.isMentioned(m.id) ? named : '',
    tags: m.root !== m.id ? [['e', m.root, '', 'root']] : [],
  }))
  return unreadOnPlace(asPlace, judge.merged, { stream: judge.context, me: judge.me, following: judge.following, muted: judge.muted, floor: judge.floor }).length > 0
}
