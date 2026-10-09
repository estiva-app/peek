import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRelayViewer } from './foreign'
import { viewerQuery } from '@/nostr/foreign'
import {
  applyLiveEvents,
  catchUpConversation,
  confirmOwnEvent,
  readConversation,
  showOwnEvent,
  withdrawOwnEvent,
} from '@/nostr/conversationCatchUp'
import { announceFileNews, conversationKey, conversationsFor } from './conversations'
import { KIND, type SignedEvent } from '@estiva-app/protocol'
import {
  composeCommentAsViewer,
  deleteEventAsViewer,
  editCommentAsViewer,
  eventIdOf,
  publishConfirmed,
  reactAsViewer,
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

export type { ConversationContainer, ConversationEvent, FileConversation, OutgoingAttachment, WriteResult }
export { conversationKeyOf, relayAttachmentOf } from '@/nostr/fileConversation'

/** What a file's conversation is, once asked: the events, or why not. */
export type FileConversationState = FileConversation | 'loading' | { failed: RelayFailureKind }

/**
 * Everything a person can do to a file's conversation.
 *
 * A message or a reply is drawn the moment it is written and sent after
 * (OPT-6): it goes into the held conversation under the id it will have, so
 * the relay's acceptance changes nothing on screen, and a refusal takes it
 * out again. Each promise settles with the relay's answer, as before, so the
 * composer still puts back what a refused send held.
 *
 * Every other write is followed by a catch-up, and one that the relay refused
 * reports the refusal and asks nothing. Any write naming a message still being
 * sent waits for that send, and is refused with it (Miky, 7 Oct).
 */
export interface FileConversationActions {
  /** `urgent`: the people the body's urgent mentions name, by pubkey (CON-17). */
  comment: (body: string, files?: readonly OutgoingAttachment[], urgent?: readonly string[]) => Promise<WriteResult>
  reply: (parent: ConversationEvent, body: string, files?: readonly OutgoingAttachment[], urgent?: readonly string[]) => Promise<WriteResult>
  /** `files`, when given, is the whole attachment set after the edit — never empty. */
  edit: (targetEventId: string, body: string, files?: readonly OutgoingAttachment[]) => Promise<WriteResult>
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

/** Your own messages drawn and not yet answered by the relay, by id, with the answer to come. */
const sending = new Map<string, Promise<WriteResult>>()

/** Null once `id` is not being sent or was accepted; the refusal of what depends on it, when it was refused. */
async function afterSend(id: string): Promise<WriteResult | null> {
  const flight = sending.get(id)
  if (!flight) return null
  return (await flight).ok ? null : { ok: false, reason: 'The message this was about was not sent.' }
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
  rootIds: readonly string[],
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
  const ids = container?.kind === 'file' ? rootIds.join(',') : ''

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
    if (!key || !container || !at) return
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
          const { value, events } = await readConversation(container, roots, query)
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
        if (kind === 'not_a_member') conversations.drop(key)
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
    A write about a message — an edit, a reaction, a resolution, a delete —
    waits for that message's own send, then catches up on success. The
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
      const built = await composeCommentAsViewer({ container, ...args }, v.relayUrl, v.token)
      if (!built.ok) return built
      const id = await eventIdOf(built.event)
      const conversations = conversationsFor(v.relayUrl, v.token.pubkey)
      const roots = ids ? ids.split(',') : []
      const query = viewerQuery(v.relayUrl, v.token)
      const refusal = container.kind === 'channel' ? 'The relay refused the message.' : 'The relay refused the comment.'
      const flight = publishConfirmed(built.event, v.relayUrl, v.token, refusal)
      sending.set(id, flight)
      const drawn = await showOwnEvent(conversations, key, container, roots, { ...built.event, id, sig: '' }, query).catch(
        (error: unknown) => {
          console.warn('[nostr] drawing a sent message failed:', error)
          return false
        },
      )
      const result = await flight
      sending.delete(id)
      if (result.ok && result.id === id) {
        confirmOwnEvent(id)
        if (!drawn) void sync()
        return result
      }
      // Refused, or signed as something other than what was drawn: what the relay holds is found by a catch-up.
      if (drawn) await withdrawOwnEvent(conversations, key, container, roots, id, query)
      else confirmOwnEvent(id)
      if (result.ok) void sync()
      return result
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the container is `key`, by value
    [key, ids, viewer, sync],
  )

  const actions: FileConversationActions = {
    comment: (body, files, urgent) => send({ body, files, urgent }),
    reply: (parent, body, files, urgent) => send({ body, parent, files, urgent }),
    edit: (targetEventId, body, files) =>
      container
        ? write(targetEventId, (url, token) => editCommentAsViewer({ container, targetEventId, body, files }, url, token))
        : Promise.resolve(SIGNED_OUT),
    remove: (targetEventId) => write(targetEventId, (url, token) => deleteEventAsViewer(targetEventId, url, token)),
    react: (targetEventId, emoji) => write(targetEventId, (url, token) => reactAsViewer({ targetEventId, emoji }, url, token)),
    resolve: (targetEventId, action, message, supportingEventId) =>
      container
        ? write(targetEventId, (url, token) =>
            resolveAsViewer({ container, targetEventId, action, message, supportingEventId }, url, token),
          )
        : Promise.resolve(SIGNED_OUT),
  }

  const state: FileConversationState = !key
    ? 'loading'
    : held
      ? held
      : failure?.key === key
        ? { failed: failure.failed }
        : 'loading'

  return { state, reload, actions, viewerPubkey: v?.token.pubkey ?? null }
}
