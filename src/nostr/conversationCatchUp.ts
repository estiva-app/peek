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
 *    mentions), its field changes and its own replaceable event; the Folder's
 *    messages, edits and resolutions (`#h`); deletions by whoever wrote what is
 *    held (`kind:5` carries no `h`); reactions on the newest messages. A fixed
 *    number of filters, so one REQ however long the conversation. Nothing new:
 *    the cursor moves and that is the whole return.
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

/** NIP-29's moderation delete: a Folder admin removes a message. It carries the Folder's `h`. */
const KIND_ADMIN_DELETION = 9005

/** What a conversation is made of: the kinds the store holds and answers. */
const HELD_KINDS: ReadonlySet<number> = new Set([
  KIND.COMMENT,
  KIND.STREAM_MESSAGE,
  KIND.DELETION,
  KIND_ADMIN_DELETION,
  KIND.REACTION,
  KIND.MESSAGE_EDIT,
  KIND.ASSERTION,
])

/** What names a held event by `e`: a reply, and everything done to it. */
const BY_E_KINDS = [KIND.COMMENT, KIND.STREAM_MESSAGE, KIND.DELETION, KIND.REACTION, KIND.MESSAGE_EDIT, KIND.ASSERTION]

/** Messages whose deletions are also asked by `#e`, newest first: a deletion signed by somebody who wrote nothing held — an agent's owner. */
const DELETION_TARGETS = 200

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
  /**
   * The relay no longer shows the newest held message and nothing deleted it:
   * the viewer lost the Folder. Buzz answers a read of a channel one may not
   * read with nothing, not a refusal, so this is how it shows. Nothing was
   * merged; the caller drops what is held.
   */
  lost?: boolean
}

const NOTHING: CaughtUp = { changed: false, object: false, mentions: false, authors: [] }

/**
 * Bring the conversation `key` holds up to date. Throws what the relay query
 * throws. A failure of the first request leaves the store as it was; of the
 * second, what the first found is folded and drawn and the cursor stays, so
 * the next try asks again from the same point.
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

  /*
    A fixed number of filters whatever the conversation's length, so the first
    request is one REQ for a DM of twenty thousand messages too. What names a
    held event is found by what else it carries: a reply, an edit and a
    resolution and an admin's delete carry the Folder's `h` (a file's replies
    its `A` as well); a deletion carries neither, so it is asked by who could
    have signed it — whoever wrote anything held, a reaction included — and, for
    the newest {@link DELETION_TARGETS} messages, by `#e` too, for an agent's
    owner who wrote nothing here; a reaction is asked for the newest
    {@link TARGETS_PER_FILTER} messages, the horizon its fold draws.

    And the newest held message by id: still answered, the viewer can still
    read the Folder.
  */
  const local = store.query(key)
  const messages = await local([{ kinds: [KIND.COMMENT, KIND.STREAM_MESSAGE] }])
  const writers = [...new Set((await local([{ kinds: [...HELD_KINDS] }])).map((event) => event.pubkey))]
  const newest = messages.slice(0, DELETION_TARGETS).map((event) => event.id)
  const probe = messages[0]?.id
  const asked = [...new Set([...missing, ...(probe ? [probe] : [])])]
  const filters: Record<string, unknown>[] = [
    { kinds: [KIND.STREAM_MESSAGE, KIND.MESSAGE_EDIT, KIND.ASSERTION, KIND_ADMIN_DELETION], '#h': [container.h], since },
    ...chunked(writers).map((authors) => ({ kinds: [KIND.DELETION], authors, since })),
    ...chunked(newest).map((ids, i) => ({ kinds: i === 0 ? [KIND.DELETION, KIND.REACTION] : [KIND.DELETION], '#e': ids, since })),
    ...(asked.length ? [{ ids: asked, limit: asked.length }] : []),
  ]
  if (address) {
    filters.push(
      { kinds: [KIND.COMMENT], '#A': [address], since },
      { kinds: [KIND.COMMENT, KIND.STREAM_MESSAGE], '#a': [address], since },
      { kinds: [KIND_FIELD_CHANGE], '#a': [address], since },
    )
    try {
      const pointer = referenceToPointer(address)
      filters.push({ kinds: [pointer.kind], authors: [pointer.pubkey], '#d': [pointer.identifier], since })
    } catch {
      /* not an address: nothing of its own to watch */
    }
  }
  const answer = await query(filters)
  const answered = new Set(answer.map((event) => event.id))

  if (probe && !answered.has(probe) && !answer.some((event) => isDeletion(event) && namesTarget(event, probe))) {
    return { ...NOTHING, lost: true }
  }

  const object = answer.some((event) => !HELD_KINDS.has(event.kind))
  const first = store.merge(
    key,
    answer.filter(
      (event) => HELD_KINDS.has(event.kind) && (!address || belongsToFile(event, address, held, answered)),
    ),
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

  /*
    From here what the first request found is merged, so it is drawn whatever
    happens next: a deletion is never held back behind a second request that
    failed. The cursor moves only when both succeeded.
  */
  const fold = () => foldHeld(store, key, container, rootIds, query)
  try {
    const newIds = first.added.filter((event) => !isDeletion(event)).map((event) => event.id)
    let disputed = first.disputed
    if (newIds.length) {
      const more = await query(chunked(newIds).map((ids) => ({ kinds: BY_E_KINDS, '#e': ids })))
      disputed = [...disputed, ...store.merge(key, more.filter((event) => HELD_KINDS.has(event.kind))).disputed]
    }
    // A deletion signed by somebody other than the author: the relay says whether it took it.
    if (disputed.length) {
      const remaining = new Set((await query([{ ids: disputed, limit: disputed.length }])).map((event) => event.id))
      store.forget(
        key,
        disputed.filter((id) => !remaining.has(id)),
      )
    }
  } catch (error) {
    store.settle(key, null, await fold())
    throw error
  }
  store.settle(key, startedAt, await fold())
  return { changed: true, object, mentions, authors }
}

/** The read's own fold, over what is held — a file's roots including those found since the object was read. */
async function foldHeld(
  store: ConversationStore<FileConversation>,
  key: string,
  container: ConversationContainer,
  rootIds: readonly string[],
  query: QueryFn,
): Promise<FileConversation> {
  const local = store.query(key)
  const roots = container.kind === 'file' ? await rootsHeld(local, container.address, container.h, rootIds) : []
  return conversationWith(container, roots, heldOrRelay(local, query))
}

const isDeletion = (event: SignedEvent) => event.kind === KIND.DELETION || event.kind === KIND_ADMIN_DELETION

const namesTarget = (event: SignedEvent, id: string) => event.tags.some((tag) => tag[0] === 'e' && tag[1] === id)

/**
 * Whether an event a file's catch-up found is the file's, rather than the rest
 * of its Folder: the Folder's `h` brings every topic's talk in it. It names the
 * file, or names by `e` something held or found alongside it. A deletion is
 * kept either way — it applies only to what it names.
 */
function belongsToFile(event: SignedEvent, address: string, held: ReadonlySet<string>, answered: ReadonlySet<string>): boolean {
  if (isDeletion(event)) return true
  return event.tags.some(
    (tag) =>
      ((tag[0] === 'a' || tag[0] === 'A') && tag[1] === address) ||
      (tag[0] === 'e' && !!tag[1] && (held.has(tag[1]) || answered.has(tag[1]))),
  )
}

/**
 * The file's roots: the object's, and every comment on it held since — a new
 * root is not in the object's list until the object is read again, and a
 * catch-up does not read it for that. A `kind:9` counts only when the object
 * already names one, as its owner's manifest does.
 */
async function rootsHeld(local: QueryFn, address: string, folder: string, rootIds: readonly string[]): Promise<string[]> {
  const known = rootIds.length ? await local([{ ids: [...rootIds], limit: rootIds.length }]) : []
  const kinds = [...new Set([KIND.COMMENT, ...known.map((event) => event.kind)])]
  const onFile = await local([{ kinds, '#a': [address] }])
  const added = onFile
    // A `kind:9` is an owner's comment only in the file's own Folder; one elsewhere naming it is a mention.
    .filter((event) => isCommentOn(event, address, kinds) && (event.kind === KIND.COMMENT || event.tags.some((t) => t[0] === 'h' && t[1] === folder)))
    .sort((a, b) => a.created_at - b.created_at)
    .map((event) => event.id)
  return [...new Set([...rootIds, ...added])]
}
