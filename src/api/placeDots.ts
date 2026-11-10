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
import { fileContext, followingOf, streamMarkerOf, unreadOnListedFile, unreadOnPlace, type Following, type TeamsList } from '@estiva-app/conversation'
import { encodeNpub, type SignedEvent } from '@estiva-app/protocol'
import type { StreamMessage } from '@estiva-app/conversation'
import { rootOf } from '@/nostr/channelStreams'
import { explainUnread, type RowNewsItem } from './rowNews'

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

type PlaceJudgeArgs = { context: string; me: string; following: Following; muted: boolean; merged: Readonly<Record<string, number>>; floor: number; isMentioned: (id: string) => boolean }

/** Whether the place's stream has something new for `me` at the level they follow it at. */
export function placeHasUnread(messages: readonly StreamMessage[], judge: PlaceJudgeArgs): boolean {
  return placeNews(messages, judge).length > 0
}

/**
 * What is new for `me` on the place's own stream, a line each with its reason (ACT-3): the same messages
 * `placeHasUnread` lights for. The stream holds no words, so the lines carry none; the card asks for them.
 */
export function placeNews(messages: readonly StreamMessage[], judge: PlaceJudgeArgs): RowNewsItem[] {
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
  const unread = unreadOnPlace(asPlace, judge.merged, { stream: judge.context, me: judge.me, following: judge.following, muted: judge.muted, floor: judge.floor })
  const rootOf = new Map(messages.map((m) => [m.id, m.root]))
  return explainUnread(asPlace, unread, judge.me, (m) => ({ root: rootOf.get(m.id) ?? m.id }))
}

/**
 * What a topic's list holds that its dot judges (TOPI-3, ACT-2): each file it lists directly, and each file one level
 * under one of those (`under`: a listed project's issue, a listed document's page), with the comments held on it.
 */
export type ListedNews = readonly { file: string; events: readonly SignedEvent[]; under?: boolean }[]

/**
 * Whether a file the topic lists has something new for `me` — what lights the topic's dot beside its own stream
 * (TOPI-3, ACT-2), by the shared rule (`unreadOnListedFile`):
 *
 * - at **Important**, what names `me` on a listed file or on one a level under it: a mention of them, and a reply in
 *   a conversation they are in (wrote in it, or were mentioned or answered there). A new conversation that names
 *   nobody stays dark;
 * - at **All**, on a file the topic lists directly, every message said after `me` chose All too: choosing it never
 *   brings back older talk (Miky, 2026-11-03). One level under, only what names `me`, at either level;
 * - a mute keeps the mentions alone; nothing lights when `me` is not in the topic, nor from before their start on it.
 *
 * Each file is judged in its own stream (the file's context), so a file read in Ship, on its own page or in the
 * topic (its own marker moved) stays dark; a reply by its thread's marker.
 *
 * Known limit: the Topics column's read holds only each file's newest comment or two (the ones it already fetched
 * to time its topics; interop's `TopicActivity.comments`), and the live watch adds each new one; the membership
 * read adds every comment `me` wrote or that tags them, within its horizon. An older unread comment from someone
 * else, naming nobody, under a newer one, is not held, so at All it does not light the dot until the next comment.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/at-important-what-names-you-on-a-listed-file-lights-the-topic.md
 */
export function listedHaveUnread(news: ListedNews, judge: ListedJudgeArgs): boolean {
  if (!judge.following.in) return false
  return news.some(({ file, events, under }) => unreadOnListed(file, events, under, judge).length > 0)
}

export type ListedJudgeArgs = { me: string; following: Following; muted: boolean; merged: Readonly<Record<string, number>>; floor: number }

/**
 * A lit topic's card, whole (383a4d3b): what lit it from its listed files, and the judge that lit it. The Topics
 * column holds only each listed file's newest comment from before the page opened, so the card reads the rest while
 * it is open (`useListedFill`) and judges them by the same rule.
 */
export interface ListedFill {
  held: ListedNews
  judge: ListedJudgeArgs
}

/**
 * The files a topic's card reads more of while it is open: each listed file (or one under it) that lights the topic,
 * from its own marker, never before the horizon. A message before the marker is read there, so only what is after
 * it can still be new (a reply in an unopened thread before it is the exception, and it stays as held).
 */
export function listedReadsOf({ held, judge }: ListedFill): { file: string; since: number }[] {
  if (!judge.following.in) return []
  return held.flatMap(({ file, events, under }) => {
    const stream = fileContext(file)
    if (!stream || unreadOnListed(file, events, under, judge).length === 0) return []
    return [{ file, since: Math.max(judge.floor, streamMarkerOf(judge.merged, stream) ?? 0) }]
  })
}

function unreadOnListed(file: string, events: readonly SignedEvent[], under: boolean | undefined, judge: ListedJudgeArgs): SignedEvent[] {
  const stream = fileContext(file)
  if (!stream || events.length === 0) return []
  const place = { stream, me: judge.me, following: judge.following, muted: judge.muted, floor: judge.floor, ...(under ? { under } : {}) }
  return unreadOnListedFile(events, judge.merged, place)
}

/**
 * What is new for `me` on the files a topic lists, a line each with its reason and the file it is on (ACT-3): the
 * same messages `listedHaveUnread` lights the topic for. Each comment is held whole, so its words come with it.
 */
export function listedNews(news: ListedNews, judge: ListedJudgeArgs): RowNewsItem[] {
  if (!judge.following.in) return []
  return news.flatMap(({ file, events, under }) =>
    explainUnread(events, unreadOnListed(file, events, under, judge), judge.me, (event) => ({ root: rootOf(event), words: event.content, file })),
  )
}

