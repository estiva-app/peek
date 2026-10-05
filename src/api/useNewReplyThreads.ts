import { useMemo, useState } from 'react'
import { REPLY_FLOOR_CONTEXT, channelContext, fileContext, threadContext } from '@estiva-app/conversation'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { fileHasUnread, replyOnlyThread } from './fileUnread'

const HORIZON_SECONDS = PEEK_HORIZON_DAYS * 24 * 60 * 60

/** The stream a conversation's thread markers fall back to (§11.3): a DM's channel, or a file. */
export type ReplyStream = { kind: 'channel'; h: string } | { kind: 'file'; address: string }

type Message = { id: string; author: string; createdAt: number }

/**
 * The dot's own judge for one stream, or undefined until the first merge has
 * landed — an unfetched marker is not an absent one.
 */
function useStreamJudge(stream: ReplyStream | null, me: string | null): Parameters<typeof fileHasUnread>[1] | undefined {
  const frontier = useReadFrontier()
  // The clock places only the 90-day absent-marker horizon, so the mount's is
  // close enough — and a render must not consult `Date.now()`.
  const [nowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  const context = !stream ? undefined : stream.kind === 'file' ? fileContext(stream.address) : channelContext(stream.h)
  return useMemo(() => {
    if (!context || !frontier.ready) return undefined
    return {
      file: frontier.marker(context),
      thread: (root: string) => frontier.marker(threadContext(root)),
      floor: frontier.marker(REPLY_FLOOR_CONTEXT),
      me: me ?? undefined,
      nowSeconds,
      horizonSeconds: HORIZON_SECONDS,
    }
  }, [context, me, frontier, nowSeconds])
}

const asReplies = (root: string, list: readonly Message[]) => list.map((reply) => ({ id: reply.id, root, by: reply.author, at: reply.createdAt }))

/**
 * Which threads in an open DM or file hold a reply that is new to the viewer —
 * the "new reply" on a message's replies row (PEE-44, Miky 2026-10-03).
 *
 * Opening a DM or a file reads its top-level messages only, so a reply newer
 * than them keeps the DM's or file's dot lit until its thread is opened. This
 * is what says which thread: judged by the dot's own rule (`fileHasUnread`,
 * the later of the stream's marker and the thread's), so the two cannot
 * disagree. Nothing is new until the first merge has landed — an unfetched
 * marker is not an absent one.
 */
export function useNewReplyThreads(
  stream: ReplyStream | null,
  replies: Readonly<Record<string, readonly Message[]>> | undefined,
  me: string | null,
): ReadonlySet<string> {
  const judge = useStreamJudge(stream, me)
  return useMemo(() => {
    const lit = new Set<string>()
    if (!judge || !replies) return lit
    for (const [root, list] of Object.entries(replies)) {
      const messages = asReplies(root, list)
      if (messages.length > 0 && fileHasUnread(messages, judge)) lit.add(root)
    }
    return lit
  }, [judge, replies])
}

/**
 * The thread to open when a DM or file is lit only by a thread reply — a Desk
 * row clicked for it opens that thread, so one click reads it (CON-34, Miky
 * 2026-10-05). `undefined` until it can be judged, `null` when a top-level
 * message is new or nothing is.
 */
export function useReplyOnlyThread(
  stream: ReplyStream | null,
  roots: readonly Message[] | undefined,
  replies: Readonly<Record<string, readonly Message[]>> | undefined,
  me: string | null,
): string | null | undefined {
  const judge = useStreamJudge(stream, me)
  return useMemo(() => {
    if (!judge || !roots || !replies) return undefined
    const top = roots.map((root) => ({ id: root.id, root: root.id, by: root.author, at: root.createdAt }))
    const threads = Object.fromEntries(Object.entries(replies).map(([root, list]) => [root, asReplies(root, list)]))
    return replyOnlyThread(top, threads, judge)
  }, [judge, roots, replies])
}
