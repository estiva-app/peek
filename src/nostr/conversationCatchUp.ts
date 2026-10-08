/**
 * A held conversation brought up to date in one or two requests (OPT-3).
 *
 * The first read of a conversation is `conversationWith` over the relay, as
 * before — staged, a dozen requests for a long topic. This file records what
 * that read was answered with, so `conversationStore` can hold it, and on a
 * return asks the relay only what changed since:
 *
 * 1. **One request** for everything new in the container `since` the cursor:
 *    a file's comments (`#A`), what names it (`#a` — its new roots and its
 *    mentions), its field changes and its own replaceable event; a channel's
 *    messages (`#h`); and what was done to anything held, by `#e` — replies,
 *    edits, reactions, resolutions and deletions (`kind:5` carries no `h`).
 *    Nothing new: the cursor moves and that is the whole return.
 * 2. **A second**, only when something arrived: what was done to the new
 *    events, by `#e`, and whether the events somebody other than their author
 *    deleted are still on the relay.
 *
 * Then the read code runs again over what is held — the same fold, answered
 * from memory — so the conversation drawn is exactly what a cold read of the
 * same events would draw.
 *
 * Only a conversation's own kinds are held and answered here. Anything else the
 * read asks (an owner's manifest, behind its own hour-long cache) goes to the
 * relay as before.
 */
import { KIND, referenceToPointer, type SignedEvent } from '@estiva-app/protocol'
import type { QueryFn } from '@estiva-app/interop'
import { isCommentOn } from '@estiva-app/conversation'
import type { ConversationStore } from '@/platform/conversationStore'
import { conversationWith, type ConversationContainer, type FileConversation } from './fileConversation'

/** A file's field changes — title, status, archive (SPEC §6.7). */
const KIND_FIELD_CHANGE = 1851

/** What a conversation is made of: the kinds the store holds and answers. */
const HELD_KINDS: ReadonlySet<number> = new Set([
  KIND.COMMENT,
  KIND.STREAM_MESSAGE,
  KIND.DELETION,
  KIND.REACTION,
  KIND.MESSAGE_EDIT,
  KIND.ASSERTION,
])

/** What names a held event by `e`: a reply, and everything done to it. */
const BY_E_KINDS = [KIND.COMMENT, KIND.STREAM_MESSAGE, KIND.DELETION, KIND.REACTION, KIND.MESSAGE_EDIT, KIND.ASSERTION]

/** Ids per `#e` filter — `decorationsOf`'s, which production already answers. */
const TARGETS_PER_FILTER = 100

const chunked = (ids: readonly string[]) => {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += TARGETS_PER_FILTER) out.push(ids.slice(i, i + TARGETS_PER_FILTER))
  return out
}

/** Whether a filter asks only for what a conversation holds. */
const isHeldFilter = (filter: Record<string, unknown>) =>
  Array.isArray(filter.kinds) ? (filter.kinds as number[]).every((kind) => HELD_KINDS.has(kind)) : Array.isArray(filter.ids)

/** The read code's query: a conversation's kinds from `held`, the rest from the relay. */
export function heldOrRelay(held: QueryFn, relay: QueryFn): QueryFn {
  return async (filters) => {
    const mine = filters.filter(isHeldFilter)
    const theirs = filters.filter((filter) => !isHeldFilter(filter))
    const [local, remote] = await Promise.all([held(mine), theirs.length ? relay(theirs) : Promise.resolve([])])
    return [...local, ...remote]
  }
}

/** A cold read of the conversation, keeping every event of a held kind its answers carried. */
export async function readConversation(
  container: ConversationContainer,
  rootIds: readonly string[],
  query: QueryFn,
): Promise<{ value: FileConversation; events: SignedEvent[] }> {
  const events: SignedEvent[] = []
  const recording: QueryFn = async (filters) => {
    const answer = await query(filters)
    for (const event of answer) if (HELD_KINDS.has(event.kind)) events.push(event)
    return answer
  }
  const value = await conversationWith(container, rootIds, recording)
  return { value, events }
}

/** What a catch-up found besides the conversation, for the reads that own it. */
export interface CaughtUp {
  /** The conversation was folded again. */
  changed: boolean
  /** The file itself changed — a field, or a new version of it: re-resolve it. */
  object: boolean
  /** Something new names the file without being a comment on it: re-read its mentions. */
  mentions: boolean
  /** Who wrote the new comments and messages, for a members list that counts them. */
  authors: string[]
}

const NOTHING: CaughtUp = { changed: false, object: false, mentions: false, authors: [] }

/**
 * Bring the conversation `key` holds up to date. Throws what the relay query
 * throws; the store is left as it was, cursor included, so the next try asks
 * again from the same point.
 */
export async function catchUpConversation(
  store: ConversationStore<FileConversation>,
  key: string,
  container: ConversationContainer,
  rootIds: readonly string[],
  query: QueryFn,
  now: () => number = Date.now,
): Promise<CaughtUp> {
  const since = store.since(key)
  if (since === undefined) return NOTHING
  const startedAt = now()
  const heldIds = store.ids(key)
  const held = new Set(heldIds)
  const address = container.kind === 'file' ? container.address : null
  const missing = rootIds.filter((id) => !held.has(id))

  const containerFilters: Record<string, unknown>[] = []
  if (address) {
    containerFilters.push(
      { kinds: [KIND.COMMENT], '#A': [address], since },
      { kinds: [KIND.COMMENT, KIND.STREAM_MESSAGE], '#a': [address], since },
      { kinds: [KIND_FIELD_CHANGE], '#a': [address], since },
    )
    try {
      const pointer = referenceToPointer(address)
      containerFilters.push({ kinds: [pointer.kind], authors: [pointer.pubkey], '#d': [pointer.identifier], since })
    } catch {
      /* not an address: nothing of its own to watch */
    }
  } else {
    containerFilters.push({ kinds: [KIND.STREAM_MESSAGE], '#h': [container.h], since })
  }
  const answer = await query([
    ...containerFilters,
    ...chunked(heldIds).map((ids) => ({ kinds: BY_E_KINDS, '#e': ids, since })),
    ...(missing.length ? [{ ids: missing, limit: missing.length }] : []),
  ])

  const object = answer.some((event) => !HELD_KINDS.has(event.kind))
  const first = store.merge(
    key,
    answer.filter((event) => HELD_KINDS.has(event.kind)),
  )
  const mentions =
    !!address &&
    first.added.some(
      (event) =>
        // A `kind:9` naming the file is told as a mention: one read too many when it was an owner's comment, never one missed.
        event.tags.some((tag) => tag[0] === 'a' && tag[1] === address) && !isCommentOn(event, address),
    )
  const authors = [
    ...new Set(
      first.added
        .filter((event) => event.kind === KIND.COMMENT || event.kind === KIND.STREAM_MESSAGE)
        .map((event) => event.pubkey),
    ),
  ]
  if (first.added.length === 0) {
    store.settle(key, startedAt)
    return { changed: false, object, mentions, authors }
  }

  const newIds = first.added.filter((event) => event.kind !== KIND.DELETION).map((event) => event.id)
  const second = [
    ...chunked(newIds).map((ids) => ({ kinds: BY_E_KINDS, '#e': ids })),
    ...(first.disputed.length ? [{ ids: first.disputed, limit: first.disputed.length }] : []),
  ]
  if (second.length) {
    const more = await query(second)
    const disputed = new Set(first.disputed)
    const remaining = new Set(more.filter((event) => disputed.has(event.id)).map((event) => event.id))
    store.forget(
      key,
      first.disputed.filter((id) => !remaining.has(id)),
    )
    store.merge(
      key,
      more.filter((event) => HELD_KINDS.has(event.kind)),
    )
  }

  const local = store.query(key)
  const roots = address ? await rootsHeld(local, address, rootIds) : []
  const value = await conversationWith(container, roots, heldOrRelay(local, query))
  store.settle(key, startedAt, value)
  return { changed: true, object, mentions, authors }
}

/**
 * The file's roots: the object's, and every comment on it held since — a new
 * root is not in the object's list until the object is read again, and a
 * catch-up does not read it for that. A `kind:9` counts only when the object
 * already names one, as its owner's manifest does.
 */
async function rootsHeld(local: QueryFn, address: string, rootIds: readonly string[]): Promise<string[]> {
  const known = rootIds.length ? await local([{ ids: [...rootIds], limit: rootIds.length }]) : []
  const kinds = [...new Set([KIND.COMMENT, ...known.map((event) => event.kind)])]
  const onFile = await local([{ kinds, '#a': [address] }])
  const added = onFile
    .filter((event) => isCommentOn(event, address, kinds))
    .sort((a, b) => a.created_at - b.created_at)
    .map((event) => event.id)
  return [...new Set([...rootIds, ...added])]
}
