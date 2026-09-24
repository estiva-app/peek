import { useCallback, useEffect, useRef, useState } from 'react'
import { useRelayViewer } from './foreign'
import { KIND } from '@estiva-app/protocol'
import {
  commentAsViewer,
  conversationAsViewer,
  deleteEventAsViewer,
  editCommentAsViewer,
  reactAsViewer,
  resolveAsViewer,
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
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { useLiveFile } from '@/nostr/useLiveFile'

export type { ConversationContainer, ConversationEvent, FileConversation, OutgoingAttachment, WriteResult }
export { conversationKeyOf } from '@/nostr/fileConversation'

/** What a file's conversation is, once asked: the events, or why not. */
export type FileConversationState = FileConversation | 'loading' | { failed: RelayFailureKind }

/**
 * Everything a person can do to a file's conversation, each answered by the
 * relay and nothing else.
 *
 * Every write here is followed by a re-read, because the relay is the only
 * store this conversation has: there is no row to patch optimistically and
 * nothing to reconcile against later. A write that the relay refused reports
 * the refusal and re-reads nothing — the view shows exactly what the relay
 * holds, which is unchanged.
 */
export interface FileConversationActions {
  comment: (body: string, files?: readonly OutgoingAttachment[]) => Promise<WriteResult>
  reply: (parent: ConversationEvent, body: string, files?: readonly OutgoingAttachment[]) => Promise<WriteResult>
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

/** The last answer for a container, and which roots it was read with. */
interface Answer {
  key: string
  ids: string
  conversation?: FileConversation
  failed?: RelayFailureKind
}

const CHANNEL_LIVE_KINDS = [KIND.STREAM_MESSAGE, KIND.MESSAGE_EDIT, KIND.ASSERTION]

/**
 * A file's conversation as Peek's own view reads it — FOL-31.
 *
 * `useForeignConversation` is the read for a file Peek can only look at: the
 * comments off the object's `#a`, drawn by `ForeignConversationView`. This is
 * the read for a file the viewer can *write* to, and it asks for more because
 * the view draws more: the replies under each comment (by `#e`), every
 * comment's tags (attachments, references), and what has been done to each
 * one since — edits, reactions, resolutions — through interop's
 * `commentDecorationsOf`. Three round trips after the object's own, and the
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
 * ## Live, the way a topic is (FOL-32)
 *
 * `useLiveFile` watches the container's Folder for `kind:1111` on the tab's
 * one socket, and the interval idles while that socket is live. The signal
 * carries no event, so it cannot say whether a new root or a reply landed and
 * both reads run: the caller's `onActivity` — the object's own read, which is
 * where the roots come from; a new one is not in `rootIds` until then, and
 * the changed ids re-read here — and this hook's `reload`, for a reply, an
 * edit or a reaction on a root already listed. When the root set did change
 * the second read is one too many, at the frequency of a new comment.
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
  const [answer, setAnswer] = useState<Answer>()
  // The answer is the container's; the root ids are only what to read in it.
  const key = !container
    ? ''
    : container.kind === 'file'
      ? `file ${container.h} ${container.address}`
      : `channel ${container.h}`
  // The identity of the array changes every render; the comment ids do not.
  const ids = container?.kind === 'file' ? rootIds.join(',') : ''

  // What is being read now, for a read that lands after the roots moved on.
  const asking = useRef({ key, ids })
  useEffect(() => {
    asking.current = { key, ids }
  }, [key, ids])

  const load = useCallback(async (): Promise<Answer | undefined> => {
    if (!key) return
    const [kind, h, address] = key.split(' ')
    const v = viewer()
    if (!v) return
    const where: ConversationContainer = kind === 'file' ? { kind: 'file', address, h } : { kind: 'channel', h }
    return conversationAsViewer(where, ids ? ids.split(',') : [], v.relayUrl, v.token)
      .then((conversation) => ({ key, ids, conversation }))
      .catch((error: unknown) => {
        const kind =
          error instanceof RelayReadError
            ? error.kind
            : classifyRelayFailure((error as Error)?.message ?? '')
        if (isOutage(kind)) recordReadFailure(kind)
        console.warn('[nostr] file conversation read failed:', error)
        return { key, ids, failed: kind as RelayFailureKind }
      })
  }, [key, ids, viewer])

  /*
    A failed *re*-read keeps the conversation it has (FOL-40), the rule the
    object's own resolve follows: one hiccup on the 30 s tick must not swap the
    list for an error and back. A first read still reports its failure; there
    is nothing to keep.
  */
  const keep = useCallback(
    (next: Answer) =>
      setAnswer((held) => (next.failed && held?.key === next.key && held.failed === undefined ? held : next)),
    [],
  )

  const reload = useCallback(async () => {
    const next = await load()
    // A slow read for the file that *was* open, or for the roots it had before
    // one was added, must not paint over what is being read now.
    if (next && next.key === asking.current.key && next.ids === asking.current.ids) keep(next)
  }, [load, keep])

  useEffect(() => {
    if (!key) return
    let cancelled = false
    void load().then((next) => !cancelled && next && keep(next))
    return () => {
      cancelled = true
    }
  }, [key, load, keep])

  const live = useLiveFile(
    container?.h,
    () => {
      onActivity?.()
      if (key) void reload()
    },
    // A channel's messages, and what is done to them that carries its `h`. A
    // reaction carries none, and arrives with the next re-read.
    container?.kind === 'channel' ? CHANNEL_LIVE_KINDS : undefined,
  )

  useRefreshTriggers(
    () => {
      if (key) void reload()
    },
    { enabled: !!key, interval: live.relayState !== 'live' },
  )

  /*
    Each write but a root comment re-reads on success. The re-read is awaited so a caller that
    puts the composer's text back on failure, or scrolls to its own message on
    success, does so against the conversation as the relay now has it.
  */
  const write = useCallback(
    async (
      run: (relayUrl: string, token: NonNullable<ReturnType<typeof viewer>>['token']) => Promise<WriteResult>,
      reread = true,
    ) => {
      const v = viewer()
      if (!v) return SIGNED_OUT
      const result = await run(v.relayUrl, v.token)
      if (result.ok && reread) await reload()
      return result
    },
    [viewer, reload],
  )

  const actions: FileConversationActions = {
    // A file's new root is not in `rootIds` until the object is re-resolved,
    // so a re-read here would find nothing new; the caller re-resolves
    // instead. A channel's is found by the channel read, so that one re-reads.
    comment: (body, files) =>
      container
        ? write((url, token) => commentAsViewer({ container, body, files }, url, token), container.kind === 'channel')
        : Promise.resolve(SIGNED_OUT),
    reply: (parent, body, files) =>
      container
        ? write((url, token) => commentAsViewer({ container, body, parent, files }, url, token))
        : Promise.resolve(SIGNED_OUT),
    edit: (targetEventId, body, files) =>
      container
        ? write((url, token) => editCommentAsViewer({ container, targetEventId, body, files }, url, token))
        : Promise.resolve(SIGNED_OUT),
    remove: (targetEventId) => write((url, token) => deleteEventAsViewer(targetEventId, url, token)),
    react: (targetEventId, emoji) => write((url, token) => reactAsViewer({ targetEventId, emoji }, url, token)),
    resolve: (targetEventId, action, message, supportingEventId) =>
      container
        ? write((url, token) =>
            resolveAsViewer({ container, targetEventId, action, message, supportingEventId }, url, token),
          )
        : Promise.resolve(SIGNED_OUT),
  }

  const state: FileConversationState =
    answer?.key !== key || !key
      ? 'loading'
      : answer.failed
        ? { failed: answer.failed }
        : (answer.conversation ?? 'loading')

  return { state, reload, actions, viewerPubkey: viewer()?.token.pubkey ?? null }
}
