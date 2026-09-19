import { useCallback, useEffect, useState } from 'react'
import { useRelayViewer } from './foreign'
import {
  commentAsViewer,
  deleteEventAsViewer,
  editCommentAsViewer,
  fileConversationAsViewer,
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

export type { ConversationContainer, ConversationEvent, FileConversation, OutgoingAttachment, WriteResult }

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
  edit: (targetEventId: string, body: string) => Promise<WriteResult>
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
 * event id. FOL-35 adds `{ kind: 'channel', h }` to the container and a topic
 * reads through here with no change to the view.
 *
 * ## Same shape as `useFileThreads`
 *
 * Keyed on the container and the root ids, so a new comment re-asks and a
 * re-render does not; `loading` until the first answer for *this* key, and a
 * failure kept apart from an empty conversation — an unreadable conversation
 * is not one nobody has written in. Refreshed on focus and reconnect through
 * `useRefreshTriggers`, the fallback for a read Convex cannot make reactive.
 */
export function useFileConversation(
  container: ConversationContainer | null | undefined,
  rootIds: readonly string[],
): {
  state: FileConversationState
  reload: () => Promise<void>
  actions: FileConversationActions
  /** The viewer's pubkey, for "You" and for which reactions are theirs. Null when signed out. */
  viewerPubkey: string | null
} {
  const viewer = useRelayViewer()
  const [answer, setAnswer] = useState<{
    key: string
    conversation?: FileConversation
    failed?: RelayFailureKind
  }>()
  // The identity of the array changes every render; the comment ids do not.
  const key = container ? `${container.address} ${container.h} ${rootIds.join(',')}` : ''

  const load = useCallback(async () => {
    if (!key) return
    const [address, h, ids] = key.split(' ')
    const v = viewer()
    if (!v) return
    return fileConversationAsViewer({ kind: 'file', address, h }, ids ? ids.split(',') : [], v.relayUrl, v.token)
      .then((conversation) => ({ key, conversation }))
      .catch((error: unknown) => {
        const kind =
          error instanceof RelayReadError
            ? error.kind
            : classifyRelayFailure((error as Error)?.message ?? '')
        if (isOutage(kind)) recordReadFailure(kind)
        console.warn('[nostr] file conversation read failed:', error)
        return { key, failed: kind as RelayFailureKind }
      })
  }, [key, viewer])

  const reload = useCallback(async () => {
    const next = await load()
    // A slow read for the file that *was* open must not paint over this one.
    if (next?.key === key) setAnswer(next)
  }, [load, key])

  useEffect(() => {
    if (!key) return
    let cancelled = false
    void load().then((next) => !cancelled && next && setAnswer(next))
    return () => {
      cancelled = true
    }
  }, [key, load])

  useRefreshTriggers(
    () => {
      if (key) void reload()
    },
    { enabled: !!key },
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
    // A new root is not in `rootIds` until the object is re-resolved, so a
    // re-read here would find nothing new; the caller re-resolves instead.
    comment: (body, files) =>
      container
        ? write((url, token) => commentAsViewer({ container, body, files }, url, token), false)
        : Promise.resolve(SIGNED_OUT),
    reply: (parent, body, files) =>
      container
        ? write((url, token) => commentAsViewer({ container, body, parent, files }, url, token))
        : Promise.resolve(SIGNED_OUT),
    edit: (targetEventId, body) =>
      container
        ? write((url, token) => editCommentAsViewer({ container, targetEventId, body }, url, token))
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
