/**
 * The dot beside a page's title and the list behind it (ACT-4; the activity indicator prototype Miky approved on 10
 * November): on a topic's, a space's, a team's, a team chat's and a DM's page, New — everything that lights the place
 * for you now, the same lines as its row's card — then Earlier, what was about you and is seen now (a mention of you, a
 * reply in your conversation). By the shared rule's lists (SPEC §11.8 *What lit a stream, new and seen*;
 * `whatLitPlace`, `whatLitListedFile`, `whatLitStream`), so every app draws the same list.
 *
 * The dot is lit from what the page's row already judges (`useConversationBadges`, `useTeamChatNews`, `useUnread`).
 * The list reads only while it is open (its content mounts with it): one pooled read of the place's recent talk, and
 * its listed files', never on the page's open.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/at-important-what-names-you-on-a-listed-file-lights-the-topic.md
 */
import { useEffect, useMemo, useState } from 'react'
import { KIND_BARE_FILE, type ForeignObject } from '@estiva-app/interop'
import {
  channelContext,
  fileContext,
  isAbout,
  isReply,
  mergeLitLines,
  THREAD_RULE_FROM,
  whatLitListedFile,
  whatLitPlace,
  whatLitStream,
  type LitLine,
  type PlaceJudge,
  type StreamJudge,
  type UnreadReason,
} from '@estiva-app/conversation'
import type { UnreadDotTone } from '@estiva-app/ui'
import { fileIdOf, KIND, MAX_FILTERS_PER_QUERY, type SignedEvent } from '@estiva-app/protocol'
import { heldToken } from '@/auth/heldSession'
import { channelStreamFilters, rootOf, streamMessagesByFolder, type StreamMessage } from '@/nostr/channelStreams'
import { viewerQuery } from '@/nostr/foreign'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { filePath } from '@/lib/objectUrl'
import { useDeskListedNews } from './deskListedNews'
import { useRelayViewer } from './foreign'
import type { ListedNews, TopicJudges } from './placeDots'
import { hasRelay } from './relayUrl'
import type { RowNewsItem } from './rowNews'
import { reactionLine, reactionsIn, streamContextsOf } from './reactionNews'
import { useConversationBadges } from './useConversationBadges'
import { useReactionsToMe, type ReactionsToMe } from './useReactionsToMe'
import { chatMessagesOf, useTeamChatNews, type Team } from './useTeams'
import { useUnread } from './unread'

/** One line of a page's list: a row card's line, and whether it is seen, where it opens and, on a team's list, where it was said. */
export interface PageLine extends RowNewsItem {
  /** Read already: an Earlier line. Only what was about you stays once seen (SPEC §11.8 *What lit a stream, new and seen*). */
  seen: boolean
  /** Where a click opens it: the message at its thread. */
  href: string
  /** The place it was said in, on a team's list: "# general", a space's or a topic's name. */
  where?: string
}

/** The most lines a page's list holds: every new one, then the newest seen ones up to it. */
export const PAGE_LINES = 50
/** The most of a place's own talk its list reads, and of each file it lists. */
const PLACE_READ = 100
const LISTED_READ = 50

/** What a page's list reads and judges: a topic or space (its own talk and its listed files'), a team's chat, a DM. */
export type PageSource =
  | { type: 'topic'; address: string; href: string; where?: string; judges: TopicJudges; listed?: ListedNews }
  | { type: 'chat'; team: string; href: string; where?: string; judge: PlaceJudge }
  | { type: 'dm'; channel: string; href: string; judge: StreamJudge }

/** The dot beside a page's title: lit, the New lines the page already holds, and what its list reads once open. */
export interface PageDot {
  lit: boolean
  /** Its colour when lit, as its row's (ACT-7): orange when reactions to you are all that is new here. */
  tone?: UnreadDotTone
  held: readonly PageLine[]
  /** Undefined until the page knows how it is judged: the list waits with its loading line. */
  sources: readonly PageSource[] | undefined
}

/** Where a line opens (as a row card's): a listed file's at its thread, a topic's at its thread, a chat's or DM's reply at its thread, a chat message in the place. */
function hrefOf(item: Pick<RowNewsItem, 'id' | 'root' | 'file' | 'reaction'>, placeHref: string, place: 'topic' | 'chat' | 'dm'): string {
  const thread = `?thread=${encodeURIComponent(item.root)}`
  if (item.file) return `${filePath(item.file)}${thread}`
  // A reaction opens where the message it reacts to was said (ACT-7).
  return place === 'topic' || item.root !== (item.reaction?.target ?? item.id) ? `${placeHref}${thread}` : placeHref
}

const asLines = (items: readonly RowNewsItem[], placeHref: string, place: 'topic' | 'chat' | 'dm', where?: string): PageLine[] =>
  items.map((item) => ({ ...item, seen: false, href: hrefOf(item, placeHref, place), ...(where ? { where } : {}) }))

const NO_LINES: readonly PageLine[] = []
const NO_FILES: readonly ForeignObject[] = []
const isPlace = (file: ForeignObject | undefined) => Number(file?.address?.split(':')[0]) === KIND_BARE_FILE

/** A topic's or a space's own page (`useFilePane`): the dot its row has in Topics, its listed files' news included. */
export function useTopicPageDot(file: ForeignObject | undefined, placeHref: string): PageDot | undefined {
  const topic = isPlace(file) && file?.address ? file : undefined
  const files = useMemo(() => (topic ? [topic] : undefined), [topic])
  const listed = useDeskListedNews(files ?? NO_FILES)
  const { unread, news, judges, tones } = useConversationBadges(files, { hold: true, listed, reactions: true })
  return useMemo(() => {
    if (!topic?.address) return undefined
    const judged = judges[topic.ref]
    return {
      lit: unread[topic.ref] === true,
      tone: tones[topic.ref] ?? 'blue',
      held: asLines(news[topic.ref] ?? NO_LINES, placeHref, 'topic'),
      // A topic in no Folder, or with no context for this viewer, is never judged (nothing there lights): its list has
      // nothing to read, rather than a loading line for good.
      sources: judged
        ? [{ type: 'topic', address: topic.address, href: placeHref, judges: judged, listed: listed.get(topic.address) }]
        : topic.folder && fileContext(topic.address)
          ? undefined
          : [],
    }
  }, [topic, judges, unread, news, listed, placeHref, tones])
}

/** A team's chat (`TeamChat`): the dot its row has in Teams, for someone in the chat. */
export function useTeamChatPageDot(team: Team, placeHref: string): PageDot {
  const teams = useMemo(() => [team], [team])
  const { unread, news, tones } = useTeamChatNews(teams)
  const me = heldToken()?.pubkey
  return useMemo(
    () => ({
      lit: unread[team.id] === true,
      tone: tones[team.id] ?? 'blue',
      held: asLines(news[team.id] ?? NO_LINES, placeHref, 'chat'),
      sources: me ? chatSource(team, me, placeHref) : undefined,
    }),
    [team, unread, news, tones, me, placeHref],
  )
}

/** Only a chat the viewer is in lights, so only that one lists (`chatNews`). */
const chatSource = (team: Team, me: string, href: string, where?: string): PageSource[] =>
  team.chat.in ? [{ type: 'chat', team: team.id, href, ...(where ? { where } : {}), judge: { stream: team.id, me, following: team.chat } }] : []

/** A DM (`Header`): the dot its row has in People. `channel` is the DM's channel uuid, once it has one. */
export function useDmPageDot(dmId: string, channel: string | undefined, placeHref: string): PageDot {
  const { dmHasUnread, dmNews, dmTone } = useUnread()
  const me = heldToken()?.pubkey
  const lit = dmHasUnread(dmId)
  const tone = dmTone(dmId)
  const items = dmNews(dmId)
  const stream = channel ? channelContext(channel) : undefined
  return useMemo(
    () => ({
      lit,
      tone,
      held: asLines(items, placeHref, 'dm'),
      sources:
        me && channel && stream
          ? [{ type: 'dm', channel, href: placeHref, judge: { stream, me, member: true, floor: horizon() } }]
          : me
            ? []
            : undefined,
    }),
    [lit, tone, items, me, channel, stream, placeHref],
  )
}

/**
 * A team's page (`TeamPage`): lit when its chat, one of its spaces or one of the topics it leads is — their listed
 * files included — and its list is theirs together, each line naming where it was said.
 */
export function useTeamPageDot(
  team: Team,
  places: readonly ForeignObject[],
  { chatHref, chatWhere }: { chatHref: string; chatWhere: string },
): PageDot {
  // Keyed on the places and their titles (a line names where it was said), not the array the page builds on each render.
  const key = places.map((place) => `${place.address ?? place.ref}|${place.slots.title?.value ?? ''}`).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const files = useMemo(() => places.filter((place) => place.address), [key])
  const listed = useDeskListedNews(files)
  const badges = useConversationBadges(files, { hold: true, listed, reactions: true })
  const teams = useMemo(() => [team], [team])
  const chat = useTeamChatNews(teams)
  const me = heldToken()?.pubkey
  return useMemo(() => {
    const titleOf = (file: ForeignObject) => file.slots.title?.value ?? 'Untitled'
    const held = [
      ...asLines(chat.news[team.id] ?? NO_LINES, chatHref, 'chat', chatWhere),
      ...files.flatMap((file) => asLines(badges.news[file.ref] ?? NO_LINES, filePath(file.address!, file.slots.title?.value), 'topic', titleOf(file))),
    ]
    /*
      The list reads once the places are judged, so none is left out as having nothing. They are judged together, once
      read state, membership and the teams are in (`useConversationBadges`); a place with no context for this viewer
      (`fileContext`) never is, and is skipped rather than holding the whole list on its loading line.
    */
    const judgeable = files.filter((file) => file.folder && fileContext(file.address))
    const judged = judgeable.length === 0 || judgeable.some((file) => badges.judges[file.ref])
    const lit = chat.unread[team.id] === true || files.some((file) => badges.unread[file.ref] === true)
    // Blue wins: orange only when every lit place under the team is lit by reactions to you alone (ACT-7).
    const blue = (chat.unread[team.id] === true && chat.tones[team.id] !== 'reaction') || files.some((file) => badges.unread[file.ref] === true && badges.tones[file.ref] !== 'reaction')
    return {
      lit,
      tone: lit && !blue ? 'reaction' : 'blue',
      held: newestFirstLines(held),
      sources:
        me && judged
          ? [
              ...chatSource(team, me, chatHref, chatWhere),
              ...files.filter((file) => badges.judges[file.ref]).map(
                (file): PageSource => ({
                  type: 'topic',
                  address: file.address!,
                  href: filePath(file.address!, file.slots.title?.value),
                  where: titleOf(file),
                  judges: badges.judges[file.ref]!,
                  listed: listed.get(file.address!),
                }),
              ),
            ]
          : undefined,
    }
  }, [team, files, badges, chat, listed, me, chatHref, chatWhere])
}

/** The earliest a list reads from: the horizon, to the hour, so the same list asks the same read all hour. */
function horizon(): number {
  const now = Math.floor(Date.now() / 1000)
  return Math.floor((now - PEEK_HORIZON_DAYS * 24 * 60 * 60) / 3600) * 3600
}

/** Each source's filters: a topic's own comments and each listed file's, a chat's or a DM's channel. */
function filtersOf(source: PageSource, since: number): Record<string, unknown>[] {
  const comments = (address: string, limit: number) => {
    const id = fileIdOf(address)
    return [
      { kinds: [KIND.COMMENT], '#A': [address], since, limit },
      ...(id ? [{ kinds: [KIND.COMMENT], '#O': [id], since, limit }] : []),
    ]
  }
  switch (source.type) {
    case 'topic':
      return [...comments(source.address, PLACE_READ), ...(source.listed ?? []).flatMap((entry) => comments(entry.file, LISTED_READ))]
    case 'chat':
      return channelStreamFilters([source.team], since, PLACE_READ)
    case 'dm':
      return channelStreamFilters([source.channel], since, PLACE_READ)
  }
}

/**
 * What a list read, by reader and filters, kept for a minute: opening the same list again at once asks nothing, and
 * later reads again, so what was said since is in it. The newest few only.
 */
const readCache = new Map<string, { at: number; events: readonly SignedEvent[] }>()
const FRESH_MS = 60_000
const CACHED_LISTS = 20
const cachedRead = (key: string) => {
  const hit = readCache.get(key)
  return hit && Date.now() - hit.at < FRESH_MS ? hit.events : undefined
}
const cacheRead = (key: string, events: readonly SignedEvent[]) => {
  readCache.delete(key)
  readCache.set(key, { at: Date.now(), events })
  while (readCache.size > CACHED_LISTS) readCache.delete(readCache.keys().next().value!)
}

/**
 * A page's list, read once it is open: undefined while it reads. New is everything unread now, and every line the page
 * already held (`held`) stays in it, so the list never says less than the dot; Earlier is what was about you. Newest
 * first in each, at most {@link PAGE_LINES} (never cutting a new line). A refused read is `'failed'`: the list then
 * draws what the page held and says Earlier could not be read, never "Nothing here yet.".
 */
export function usePageLines(sources: readonly PageSource[] | undefined, held: readonly PageLine[] = NO_LINES): readonly PageLine[] | 'failed' | undefined {
  const viewer = useRelayViewer()
  const { merged } = useReadFrontier()
  // The reactions to you, new and seen (ACT-7): a seen one stays under Earlier, as what was about you does.
  const reactions = useReactionsToMe(!!sources)
  const filters = useMemo(() => {
    if (!sources) return undefined
    const since = horizon()
    return sources.flatMap((source) => filtersOf(source, since))
  }, [sources])
  const key = filters ? `${viewer()?.token.pubkey ?? ''}|${JSON.stringify(filters)}` : ''
  const [read, setRead] = useState<{ key: string; events: readonly SignedEvent[] | 'failed' } | undefined>(() => {
    const events = key ? cachedRead(key) : undefined
    return events ? { key, events } : undefined
  })

  useEffect(() => {
    const at = viewer()
    if (!filters || !key || read?.key === key) return
    const cached = cachedRead(key)
    if (cached) {
      setRead({ key, events: cached })
      return
    }
    if (!hasRelay || !at || filters.length === 0) {
      setRead({ key, events: [] })
      return
    }
    let live = true
    const query = viewerQuery(at.relayUrl, at.token)
    const batches: Record<string, unknown>[][] = []
    for (let start = 0; start < filters.length; start += MAX_FILTERS_PER_QUERY) batches.push(filters.slice(start, start + MAX_FILTERS_PER_QUERY))
    Promise.all(batches.map((batch) => query(batch))).then(
      (answers) => {
        const events = answers.flat() as SignedEvent[]
        cacheRead(key, events)
        if (live) setRead({ key, events })
      },
      () => {
        if (live) setRead({ key, events: 'failed' })
      },
    )
    return () => {
      live = false
    }
    // `filters` is `key`'s source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, viewer])

  return useMemo(() => {
    if (!sources || !read || read.key !== key) return undefined
    if (read.events === 'failed') return 'failed'
    const events = read.events
    // The read's lists first, so a line the read judged wins; the page's held New lines last, for any the read missed.
    return pageList([...sources.flatMap((source) => linesOf(source, events, merged, reactions)), heldList(held)])
  }, [sources, read, key, merged, held, reactions])
}

/** A message as the shared rule's lines carry one. */
type RuleMessage = Pick<SignedEvent, 'id' | 'pubkey' | 'kind' | 'created_at' | 'content' | 'tags'>

/** One stream's list: the shared rule's lines, and each one's page line (where it was said, where it opens). */
interface SourceList {
  lit: readonly LitLine<RuleMessage>[]
  lines: ReadonlyMap<string, PageLine>
}

/** The page's held New lines (the row card's) as a list of their own: each new, as the dot judged it. */
function heldList(held: readonly PageLine[]): SourceList {
  return {
    lit: held.map((line): LitLine<RuleMessage> =>
      line.reaction
        ? { type: 'reaction', reaction: { id: line.id, by: line.by, at: line.at, emoji: line.reaction.emoji, target: line.reaction.target }, seen: false }
        : {
            type: 'message',
            message: { id: line.id, pubkey: line.by, kind: 9, created_at: line.at, content: line.words ?? '', tags: [] },
            reason: line.reason as UnreadReason,
            seen: false,
          },
    ),
    lines: new Map(held.map((line) => [line.id, line] as const)),
  }
}

/**
 * One list from several streams' (`mergeLitLines`, §11.8): each message once — the first list holding it wins — every
 * new line before every seen one, each part newest first, at most {@link PAGE_LINES} without cutting a new line.
 */
function pageList(lists: readonly SourceList[]): PageLine[] {
  const lineOf = new Map<string, PageLine>()
  for (const list of lists) for (const [id, line] of list.lines) if (!lineOf.has(id)) lineOf.set(id, line)
  return mergeLitLines(
    lists.map((list) => list.lit),
    { limit: PAGE_LINES },
  ).flatMap((lit) => {
    if (lit.type === 'reaction') {
      const line = lineOf.get(lit.reaction.id)
      return line ? [{ ...line, seen: lit.seen }] : []
    }
    const line = lineOf.get(lit.message.id)
    return line ? [{ ...line, reason: lit.reason, seen: lit.seen }] : []
  })
}

/** A message as the shared rule reads one, from a channel's stream. */
const asRule = (message: StreamMessage) => ({
  id: message.id,
  pubkey: message.by,
  kind: 9,
  created_at: message.at,
  content: message.body,
  tags: message.root !== message.id ? [['e', message.root, '', 'root']] : [],
})

/** One source's lists, judged with the markers the tab holds now: a topic's own stream's and each listed file's. */
function linesOf(source: PageSource, events: readonly SignedEvent[], merged: Readonly<Record<string, number>>, reactions: ReactionsToMe): SourceList[] {
  const where = 'where' in source && source.where ? { where: source.where } : {}
  const place = source.type
  // The reactions to you in one of the source's conversations, for the shared rule's list (ACT-7).
  const reactionsOn = (conversation: string) => ({ limit: PAGE_LINES, reactions: reactionsIn(reactions, streamContextsOf(conversation)) })
  const list = (lit: readonly LitLine<RuleMessage>[], rootOfId: (message: RuleMessage) => string, file?: string): SourceList => {
    const lines = new Map<string, PageLine>()
    for (const one of lit) {
      if (one.type === 'reaction') {
        const item = reactionLine(one.reaction, reactions, file)
        lines.set(item.id, { ...item, seen: one.seen, href: hrefOf(item, source.href, place), ...where })
        continue
      }
      const { message } = one
      const item = { id: message.id, by: message.pubkey, at: message.created_at, reason: one.reason, root: rootOfId(message), words: message.content, ...(file ? { file } : {}) }
      lines.set(message.id, { ...item, seen: one.seen, href: hrefOf(item, source.href, place), ...where })
    }
    return { lit, lines }
  }
  switch (source.type) {
    case 'topic': {
      // A reply from before the thread rule's cut-over never lit a row (CON-34), as the row's own judge reads them.
      const own = byTime(events.filter((event) => isAbout(event, source.address) && (!isReply(event) || event.created_at >= THREAD_RULE_FROM)))
      const lists = [list(whatLitPlace(own, merged, source.judges.place, reactionsOn(source.address)), (m) => rootOf(m as SignedEvent))]
      for (const { file, events: heldOnFile, under } of source.listed ?? []) {
        const stream = fileContext(file)
        if (!stream) continue
        const onFile = byTime([...heldOnFile, ...events.filter((event) => isAbout(event, file))])
        const judge = { ...source.judges.listed, stream, ...(under ? { under } : {}) }
        lists.push(list(whatLitListedFile(onFile, merged, judge, reactionsOn(file)), (m) => rootOf(m as SignedEvent), file))
      }
      return lists
    }
    case 'chat': {
      const chat = chatMessagesOf(streamMessagesByFolder(events as SignedEvent[], [source.team], source.judge.me)[source.team] ?? [])
      const roots = new Map(chat.map((m) => [m.id, m.root]))
      return [list(whatLitPlace(chat.map(asRule), merged, source.judge, reactionsOn(source.team)), (m) => roots.get(m.id) ?? m.id)]
    }
    case 'dm': {
      const dm = streamMessagesByFolder(events as SignedEvent[], [source.channel], source.judge.me)[source.channel] ?? []
      const roots = new Map(dm.map((m) => [m.id, m.root]))
      return [list(whatLitStream(dm.map(asRule), merged, source.judge, { dm: true, ...reactionsOn(source.channel) }), (m) => roots.get(m.id) ?? m.id)]
    }
  }
}

/** Each event once, oldest first, as a stream is held. */
function byTime(events: readonly SignedEvent[]): SignedEvent[] {
  const byId = new Map<string, SignedEvent>()
  for (const event of events) byId.set(event.id, event)
  return [...byId.values()].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))
}

/** Newest first, each message once: the held lines of a team's places, before any read. */
function newestFirstLines(lines: readonly PageLine[]): PageLine[] {
  return [...new Map(lines.map((line) => [line.id, line] as const)).values()].sort((a, b) => b.at - a.at)
}
