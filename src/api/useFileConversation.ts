import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRelayViewer } from './foreign'
import type { StoredToken } from '@/auth/estivaId'
import type { QueryFn } from '@estiva-app/interop'
import { viewerQuery } from '@/nostr/foreign'
import { conversationFromCopy } from '@/nostr/conversationFromCopy'
import {
  applyLiveEvents,
  catchUpConversation,
  confirmOwnEvent,
  readConversation,
  showOwnEvent,
  withdrawOwnEvent,
} from '@/nostr/conversationCatchUp'
import { announceFileNews, conversationKey, conversationsFor } from './conversations'
import { KIND, type Embed, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
import {
  composeCommentAsViewer,
  composeDeletion,
  composeEdit,
  composeReaction,
  eventIdOf,
  firstPageWith,
  FIRST_PAGE,
  publishConfirmed,
  resolveAsViewer,
  type ComposeArgs,
  type ConversationContainer,
  type ConversationEvent,
  type FileConversation,
  type OutgoingAttachment,
  type WriteResult,
} from '@/nostr/fileConversation'
import {
  RelayReadError,
  classifyRelayFailure,
  isOutage,
  type RelayFailureKind,
} from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { REFRESH_INTERVAL_MS, useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { useLiveFile } from '@/nostr/useLiveFile'
import { TOPIC_NOT_CREATED, waitOnTopic } from './pendingTopics'

export type { ConversationContainer, ConversationEvent, FileConversation, OutgoingAttachment, WriteResult }
export { conversationKeyOf, relayAttachmentOf } from '@/nostr/fileConversation'

/** What a file's conversation is, once asked: the events, or why not. */
export type FileConversationState = FileConversation | 'loading' | { failed: RelayFailureKind }

/**
 * Everything a person can do to a file's conversation.
 *
 * A message, a reply (OPT-6), a reaction, an edit or a delete (OPT-8) is
 * drawn the moment it is made and sent after: it goes into the held
 * conversation under the id it will have, so the relay's acceptance changes
 * nothing on screen, and a refusal takes it out again — a refused delete puts
 * back what it took. Each promise settles with the relay's answer, as before,
 * so the caller still puts back what a refused write held and says so.
 *
 * A resolution is followed by a catch-up, and one that the relay refused
 * reports the refusal and asks nothing. Any write naming a message still being
 * sent waits for that send, and is refused with it (Miky, 7 Oct).
 */
export interface FileConversationActions {
  /** `urgent`: the people the body's urgent mentions name, by pubkey (CON-17). */
  /** `embeds`: the cards the author chose under it, one per value (SPEC §13.6.2, OPT-17). */
  comment: (body: string, files?: readonly OutgoingAttachment[], urgent?: readonly string[], embeds?: readonly Embed[]) => Promise<WriteResult>
  reply: (parent: ConversationEvent, body: string, files?: readonly OutgoingAttachment[], urgent?: readonly string[], embeds?: readonly Embed[]) => Promise<WriteResult>
  /**
   * `files`, when given, is the whole attachment set after the edit — never empty.
   * `embeds`, when given, is the whole card set after it, `none` for each card taken away.
   */
  edit: (targetEventId: string, body: string, files?: readonly OutgoingAttachment[], embeds?: readonly Embed[]) => Promise<WriteResult>
  remove: (targetEventId: string) => Promise<WriteResult>
  react: (targetEventId: string, emoji: string) => Promise<WriteResult>
  resolve: (
    targetEventId: string,
    action: 'resolved' | 'reopened',
    message?: string,
    supportingEventId?: string,
  ) => Promise<WriteResult>
}

const SIGNED_OUT: WriteResult = { ok: false, reason: 'Sign in to write to this conversation.' }

type Viewer = NonNullable<ReturnType<ReturnType<typeof useRelayViewer>>>

/** Your own messages drawn and not yet answered by the relay, by id, with the answer to come. */
const sending = new Map<string, Promise<WriteResult>>()

/** Your own comments sent before their conversation's first read, by conversation: that read asks for them (OPT-9). */
const sentBeforeRead = new Map<string, string[]>()

/** Null once `id` is not being sent or was accepted; the refusal of what depends on it, when it was refused. */
async function afterSend(id: string): Promise<WriteResult | null> {
  const flight = sending.get(id)
  if (!flight) return null
  return (await flight).ok ? null : { ok: false, reason: 'Your earlier message was not sent, so this was not either.' }
}

/**
 * One sync per conversation at a time. A sync asked for while one runs is
 * folded into a second pass after it, with the latest caller's inputs, rather
 * than run beside it: two catch-ups at once would ask the relay the same thing
 * twice.
 */
const syncs = new Map<string, { promise: Promise<void>; run: () => Promise<void>; again: boolean }>()

function coalesced(key: string, run: () => Promise<void>): Promise<void> {
  const flight = syncs.get(key)
  if (flight) {
    flight.run = run
    flight.again = true
    return flight.promise
  }
  const entry = { promise: Promise.resolve(), run, again: false }
  entry.promise = (async () => {
    try {
      do {
        entry.again = false
        await entry.run()
      } while (entry.again)
    } finally {
      syncs.delete(key)
    }
  })()
  syncs.set(key, entry)
  return entry.promise
}

/**
 * A conversation nobody has opened yet, read as its first open reads it but on
 * the `ahead` lane (PEE-5, Desk's loader), and held so that open draws it at
 * once and asks only what changed since. Nothing is held when the read fails;
 * it throws, which stops the loader.
 *
 * It runs as the conversation's sync (`coalesced`), so an open that arrives
 * meanwhile waits for it and then only catches up, rather than reading the
 * whole conversation a second time beside it; the press that opened it has
 * moved its waiting reads into the click lane. Not while a sync of it runs:
 * that one is the open's.
 */
export async function loadConversationAhead(
  container: ConversationContainer,
  rootIds: readonly string[],
  at: { relayUrl: string; token: StoredToken },
): Promise<'read' | 'held' | 'syncing'> {
  const conversations = conversationsFor(at.relayUrl, at.token.pubkey)
  const key = conversationKey(container)
  if (conversations.value(key) !== undefined) return 'held'
  if (syncs.has(key)) return 'syncing'
  // Kept, not thrown inside the sync: an open queued behind it must still run.
  let failed: { error: unknown } | undefined
  // Once an open has joined it, what is left of the read is that click's, and goes in its lane — including a read
  // already waiting to go over HTTP, which goes at once rather than waiting for the click's reads to go quiet.
  const query: QueryFn = viewerQuery(at.relayUrl, at.token, () => (syncs.get(key)?.again ? 'click' : 'ahead'))
  await coalesced(key, async () => {
    if (conversations.value(key) !== undefined) return
    try {
      const startedAt = Date.now()
      const { value, events } = await readConversation(container, [...rootIds], query)
      if (conversations.value(key) === undefined) conversations.replace(key, value, events, startedAt)
    } catch (error) {
      failed = { error }
    }
  })
  if (failed) throw failed.error
  return 'read'
}

/**
 * What a sync is asked to do, gathered while one runs: the events the socket
 * delivered, to apply, and whether anybody asked for a catch-up, which finds
 * those events too.
 */
const wanted = new Map<string, { events: SignedEvent[]; catchUp: boolean }>()

function want(key: string, event?: SignedEvent): void {
  let entry = wanted.get(key)
  if (!entry) wanted.set(key, (entry = { events: [], catchUp: false }))
  if (event) entry.events.push(event)
  else entry.catchUp = true
}

/** A channel's messages, and what is done to them that carries its `h` — an admin's delete too. A reaction carries none. */
const CHANNEL_LIVE_KINDS = [KIND.STREAM_MESSAGE, KIND.MESSAGE_EDIT, KIND.ASSERTION, 9005]

/**
 * How often an open conversation catches up while the socket is live: what no
 * `#h` filter delivers — another person's reaction, a deletion by its author —
 * arrives within this (Miky, OPT-5 kickoff). One request when nothing changed.
 */
export const LIVE_CATCH_UP_MS = 60_000

/**
 * A file's conversation as Peek's own view reads it — FOL-31.
 *
 * `useForeignConversation` is the read for a file Peek can only look at: the
 * comments off the object's `#a`, drawn by `ForeignConversationView`. This is
 * the read for a file the viewer can *write* to, and it asks for more because
 * the view draws more: the replies under each comment (by `#e`), every
 * comment's tags (attachments, references), and what has been done to each
 * one since — edits, reactions, resolutions — through
 * `@estiva-app/conversation`'s `decorationsOf`. Three round trips after the object's own, and the
 * view pays them once, whichever app owns the file.
 *
 * ## Parameterised by container, never by kind
 *
 * The caller says *where* (`{ kind: 'file', address, h }`) and this file says
 * nothing about which comment kind that means: `threadsAsViewer` reads the
 * kinds off the owning app's manifest, and the decorations are addressed by
 * event id. `{ kind: 'channel', h }` (REM-1) is a channel's `kind:9` talk —
 * a DM — and reads through here with no change to the view. A channel finds
 * its own messages, so `rootIds` is a file's only, and a new message is
 * re-read here rather than by the caller.
 *
 * ## Same shape as `useFileThreads`
 *
 * Re-read when the container or the root ids change, so a new comment re-asks
 * and a re-render does not; a failure kept apart from an empty conversation —
 * an unreadable conversation is not one nobody has written in. Refreshed on
 * focus and reconnect through `useRefreshTriggers`, the fallback for a read
 * Convex cannot make reactive.
 *
 * ## Keyed on the container alone (SID-1)
 *
 * `loading` until the first answer for *this container*, and never again for
 * it. The root ids are an input to the read, not part of the key: a new root —
 * yours after a send, someone else's live, or one the 30 s tick found — is a
 * re-read of the same conversation, like a reply, and the list stays on
 * screen until it lands. Keyed on the roots, each of those dropped the view
 * to the skeleton and remounted every card, losing the scroll and the open
 * replies.
 *
 * ## Held, and caught up (OPT-3)
 *
 * The first open reads the conversation and the tab's `conversations` store
 * holds it with the events it was made of. Going back draws what is held on
 * the first frame, and one catch-up asks the relay only what changed since
 * (`catchUpConversation`): one request when nothing did, two when something
 * did. A new root is found by that catch-up too, so the object need not be
 * read again for it; `onActivity` is called only when the file itself changed.
 *
 * ## Live, applied (FOL-32, OPT-5)
 *
 * `useLiveFile` watches the container's Folder on the tab's one socket and
 * hands over each event; `applyLiveEvents` keeps what is this conversation's
 * and folds again from memory, with no read. Another topic's talk in the same
 * Folder costs nothing. While the socket is live the catch-up runs once a
 * minute, for what the socket cannot deliver; when it is not, every 30 s.
 */
export function useFileConversation(
  container: ConversationContainer | null | undefined,
  /**
   * A file's comment ids, or null while the file is still resolving (OPT-9):
   * the view and its composer are drawn, and the read waits for them, since a
   * read without them would answer with an empty conversation.
   */
  rootIds: readonly string[] | null,
  {
    onActivity,
  }: {
    /** Something was said about the file on the relay: re-resolve the object. */
    onActivity?: () => void
  } = {},
): {
  state: FileConversationState
  reload: () => Promise<void>
  actions: FileConversationActions
  /** The viewer's pubkey, for "You" and for which reactions are theirs. Null when signed out. */
  viewerPubkey: string | null
} {
  const viewer = useRelayViewer()
  const v = viewer()
  const store = v ? conversationsFor(v.relayUrl, v.token.pubkey) : null
  // The conversation is the container's; the root ids are only what to read in it.
  const key = container ? conversationKey(container) : ''
  // The identity of the array changes every render; the comment ids do not.
  const ids = container?.kind === 'file' ? (rootIds?.join(',') ?? null) : ''

  const subscribe = useCallback(
    (listener: () => void) => (store && key ? store.subscribe(key, listener) : () => {}),
    [store, key],
  )
  const held = useSyncExternalStore(subscribe, () => (store && key ? store.value(key) : undefined))
  /*
    Why nothing is held, for this container. A failed catch-up keeps the
    conversation it has (FOL-40): one hiccup on the 30 s tick must not swap the
    list for an error and back. A first read still reports its failure; there
    is nothing to keep. Losing access is the exception — what was held is
    dropped and the view says so.
  */
  const [failure, setFailure] = useState<{ key: string; failed: RelayFailureKind }>()
  /*
    What is drawn while the first read from the relay is out, and never held:
    the conversation as the copy on the device answers the same read (PEE-4),
    or else a long file's newest comments (PEE-7). Whichever is drawn first
    stays until the whole read lands. The store holds only the relay's whole
    answer, so the catch-ups after it start from the relay's word.
  */
  const [meanwhile, setMeanwhile] = useState<{ key: string; value: FileConversation }>()
  const drawFirst = (key: string, value: FileConversation) =>
    setMeanwhile((drawn) => (drawn?.key === key ? drawn : { key, value }))

  // Written in an effect rather than during render; read from a socket frame or a timer.
  const latestActivity = useRef(onActivity)
  useEffect(() => {
    latestActivity.current = onActivity
  })

  /*
    The one read: the first open reads the conversation and holds what it was
    answered with; every later one — a return, a write, the refresh tick — asks
    only what changed since (`catchUpConversation`). An event from the socket
    is applied with no read at all (`applyLiveEvents`).
  */
  const sync = useCallback(async (event?: SignedEvent) => {
    const at = viewer()
    // Before the roots are known there is nothing to read; what the socket delivers meanwhile, the first read finds.
    if (!key || !container || !at || ids === null) return
    const conversations = conversationsFor(at.relayUrl, at.token.pubkey)
    const roots = ids ? ids.split(',') : []
    const query = viewerQuery(at.relayUrl, at.token)
    want(key, event)
    await coalesced(key, async () => {
      const asked = wanted.get(key)
      wanted.delete(key)
      if (!asked) return
      try {
        const before = conversations.value(key)
        if (before === undefined) {
          // What the socket delivered before this read began, the read finds.
          const startedAt = Date.now()
          const sent = sentBeforeRead.get(key) ?? []
          const toRead = [...new Set([...roots, ...sent])]
          conversationFromCopy(container, roots, at.relayUrl, at.token)
            .then((value) => {
              if (conversations.value(key) === undefined) drawFirst(key, value)
            })
            .catch(() => {})
          /*
            A long file's newest comments first (PEE-7): asking replies and decorations over every comment is
            what kept a 200-message topic on its placeholder for 2–3 s. Its failure is left to the whole read.
            What the placeholder waits on goes ahead of every other read the page asks (`first`).
          */
          const first = viewerQuery(at.relayUrl, at.token, 'first')
          const paged = container.kind === 'file' && toRead.length > FIRST_PAGE
          if (paged) {
            await firstPageWith(container, toRead, first)
              .then((value) => {
                if (conversations.value(key) === undefined) drawFirst(key, value)
              })
              .catch(() => {})
          }
          const { value, events } = await readConversation(container, toRead, paged ? query : first)
          sentBeforeRead.delete(key)
          // A catch-up that settled meanwhile is newer than this.
          if (conversations.value(key) === before) conversations.replace(key, value, events, startedAt)
          return
        }
        const found = asked.catchUp
          ? await catchUpConversation(conversations, key, container, roots, query)
          : await applyLiveEvents(conversations, key, container, roots, asked.events, query)
        if (found.lost) {
          // The Folder is no longer the viewer's: nothing held is drawn again, and the page reads what it may now see.
          conversations.drop(key)
          // Nor the copy's: it is older still.
          setMeanwhile(undefined)
          const startedAt = Date.now()
          const { value, events } = await readConversation(container, roots, query)
          conversations.replace(key, value, events, startedAt)
          latestActivity.current?.()
          if (container.kind === 'file') announceFileNews(container.address, { object: true, mentions: true, authors: [] })
          return
        }
        if (found.object) latestActivity.current?.()
        if (container.kind === 'file' && (found.object || found.mentions || found.authors.length)) {
          announceFileNews(container.address, { object: found.object, mentions: found.mentions, authors: found.authors })
        }
      } catch (error) {
        const kind =
          error instanceof RelayReadError ? error.kind : classifyRelayFailure((error as Error)?.message ?? '')
        if (isOutage(kind)) recordReadFailure(kind)
        console.warn('[nostr] file conversation read failed:', error)
        if (kind === 'not_a_member') {
          conversations.drop(key)
          setMeanwhile(undefined)
        }
        if (kind === 'not_a_member' || conversations.value(key) === undefined) setFailure({ key, failed: kind })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the container is `key`, by value
  }, [key, ids, viewer])

  useEffect(() => {
    if (!key) return
    store?.touch(key)
    void sync()
  }, [key, store, sync])

  const live = useLiveFile(
    container?.h,
    (event) => {
      if (key) void sync(event)
    },
    container?.kind === 'channel' ? CHANNEL_LIVE_KINDS : undefined,
  )

  useRefreshTriggers(
    () => {
      if (key) void sync()
    },
    { enabled: !!key, intervalMs: live.relayState === 'live' ? LIVE_CATCH_UP_MS : REFRESH_INTERVAL_MS },
  )

  // Never handed an argument: a caller's click event is not a relay event.
  const reload = useCallback(() => sync(), [sync])

  /*
    A resolution of a message waits for that message's own send, then
    catches up on success. The
    catch-up is awaited so a caller that puts the composer's text back on
    failure does so against the conversation as the relay now has it.
  */
  const write = useCallback(
    async (
      target: string,
      run: (relayUrl: string, token: NonNullable<ReturnType<typeof viewer>>['token']) => Promise<WriteResult>,
    ) => {
      const blocked = await afterSend(target)
      if (blocked) return blocked
      const v = viewer()
      if (!v) return SIGNED_OUT
      const result = await run(v.relayUrl, v.token)
      if (result.ok) await reload()
      return result
    },
    [viewer, reload],
  )

  /*
    A message or a reply (OPT-6): built, drawn under the id it will have, then
    signed and sent. Nothing is read after it — the socket's echo of it is
    already held. Drawn only into a conversation that is held; one still on
    its first read finds it by a catch-up once the relay has it.
  */
  const send = useCallback(
    async (args: Omit<ComposeArgs, 'container'>): Promise<WriteResult> => {
      if (args.parent) {
        const blocked = await afterSend(args.parent.id)
        if (blocked) return blocked
      }
      const v = viewer()
      if (!v || !container || !key) return SIGNED_OUT
      let built: Awaited<ReturnType<typeof composeCommentAsViewer>>
      let id: string
      try {
        built = await composeCommentAsViewer({ container, ...args }, v.relayUrl, v.token)
        if (!built.ok) return built
        id = await eventIdOf(built.event)
      } catch (error) {
        // Reported, never thrown: the composer puts the text back only on an answer.
        console.warn('[nostr] building a message failed:', error)
        return { ok: false, reason: 'The message could not be prepared. Try again.' }
      }
      const refusal = container.kind === 'channel' ? 'The relay refused the message.' : 'The relay refused the comment.'
      const result = await publishOwn(v, built.event, id, refusal)
      /*
        Sent before the conversation's first read — the composer is there while
        the file resolves (OPT-9). The file's comment ids may predate it, and a
        catch-up asks only after that read began, so the read asks for it too.
      */
      if (result.ok && !args.parent && ids === null) {
        sentBeforeRead.set(key, [...(sentBeforeRead.get(key) ?? []), result.id])
      }
      return result
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the container is `key`, by value
    [key, ids, viewer, sync],
  )

  /*
    A reaction, an edit or a delete (OPT-8): built, drawn under the id it will
    have, then sent, exactly as a message is — waiting first for the message
    it names, when that is still being sent.
  */
  const change = useCallback(
    async (target: string, build: (pubkey: string) => UnsignedEvent, refusal: string): Promise<WriteResult> => {
      const blocked = await afterSend(target)
      if (blocked) return blocked
      const v = viewer()
      if (!v || !container || !key) return SIGNED_OUT
      let event: UnsignedEvent
      let id: string
      try {
        event = build(v.token.pubkey)
        id = await eventIdOf(event)
      } catch (error) {
        console.warn('[nostr] building a change failed:', error)
        return { ok: false, reason: 'The change could not be prepared. Try again.' }
      }
      return publishOwn(v, event, id, refusal)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the container is `key`, by value
    [key, ids, viewer, sync],
  )

  /*
    Signed and sent while it is drawn; the relay's answer confirms it or takes
    it out again. Nothing is read after an accepted one — the socket's echo of
    it is already held — unless it could not be drawn.
  */
  const publishOwn = async (v: Viewer, event: UnsignedEvent, id: string, refusal: string): Promise<WriteResult> => {
    if (!container || !key) return SIGNED_OUT
    const conversations = conversationsFor(v.relayUrl, v.token.pubkey)
    const roots = ids ? ids.split(',') : []
    const query = viewerQuery(v.relayUrl, v.token)
    /*
      Into a topic just started (PEE-6): drawn now, sent once the topic is
      written, and not sent at all if it is refused — its text goes back to
      the topic's draft (Miky, PEE-6 kickoff).
    */
    const topic = container.kind === 'file' ? waitOnTopic(container.address) : undefined
    const flight = topic
      ? topic.then((outcome): Promise<WriteResult> | WriteResult =>
          outcome.ok ? publishConfirmed(event, v.relayUrl, v.token, refusal) : { ok: false, reason: TOPIC_NOT_CREATED },
        )
      : publishConfirmed(event, v.relayUrl, v.token, refusal)
    sending.set(id, flight)
    const drawn = await showOwnEvent(conversations, key, container, roots, { ...event, id, sig: '' }, query).catch((error: unknown) => {
      console.warn('[nostr] drawing your own event failed:', error)
      return false
    })
    const result = await flight
    sending.delete(id)
    if (result.ok && result.id === id) {
      confirmOwnEvent(id)
      if (!drawn) void sync()
      return result
    }
    /*
      Refused, or signed as something other than what was drawn: what the
      relay holds is found by a catch-up. Withdrawn even when the draw
      failed, which may have merged it before its fold threw.
    */
    await withdrawOwnEvent(conversations, key, container, roots, id, query).catch((error: unknown) =>
      console.warn('[nostr] withdrawing your refused event failed:', error),
    )
    if (result.ok) void sync()
    return result
  }

  const actions: FileConversationActions = {
    comment: (body, files, urgent, embeds) => send({ body, files, urgent, embeds }),
    reply: (parent, body, files, urgent, embeds) => send({ body, parent, files, urgent, embeds }),
    edit: (targetEventId, body, files, embeds) =>
      container
        ? change(targetEventId, (pubkey) => composeEdit({ container, targetEventId, body, files, embeds }, pubkey), 'The relay refused the edit.')
        : Promise.resolve(SIGNED_OUT),
    remove: (targetEventId) => change(targetEventId, (pubkey) => composeDeletion(targetEventId, pubkey), 'The relay refused the deletion.'),
    react: (targetEventId, emoji) =>
      change(targetEventId, (pubkey) => composeReaction({ targetEventId, emoji }, pubkey), 'The relay refused the reaction.'),
    resolve: (targetEventId, action, message, supportingEventId) =>
      container
        ? write(targetEventId, (url, token) =>
            resolveAsViewer({ container, targetEventId, action, message, supportingEventId }, url, token),
          )
        : Promise.resolve(SIGNED_OUT),
  }

  // A first read that failed keeps what was drawn meanwhile on screen, unless the Folder is no longer the viewer's.
  const copied = meanwhile?.key === key ? meanwhile.value : undefined
  const state: FileConversationState = !key
    ? 'loading'
    : held
      ? held
      : failure?.key === key && (failure.failed === 'not_a_member' || !copied)
        ? { failed: failure.failed }
        : (copied ?? 'loading')

  return { state, reload, actions, viewerPubkey: v?.token.pubkey ?? null }
}
