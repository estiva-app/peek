import { useMemo, useState } from 'react'
import { channelContext, fileContext, threadContext } from '@estiva-app/conversation'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { fileHasUnread } from './fileUnread'

const HORIZON_SECONDS = PEEK_HORIZON_DAYS * 24 * 60 * 60

/** The stream a conversation's thread markers fall back to (§11.3): a DM's channel, or a file. */
export type ReplyStream = { kind: 'channel'; h: string } | { kind: 'file'; address: string }

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
  replies: Readonly<Record<string, readonly { id: string; author: string; createdAt: number }[]>> | undefined,
  me: string | null,
): ReadonlySet<string> {
  const frontier = useReadFrontier()
  // The clock places only the 90-day absent-marker horizon, so the mount's is
  // close enough — and a render must not consult `Date.now()`.
  const [nowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  const context = !stream ? undefined : stream.kind === 'file' ? fileContext(stream.address) : channelContext(stream.h)
  return useMemo(() => {
    const lit = new Set<string>()
    if (!context || !replies || !frontier.ready) return lit
    const judge = {
      file: frontier.marker(context),
      thread: (root: string) => frontier.marker(threadContext(root)),
      me: me ?? undefined,
      nowSeconds,
      horizonSeconds: HORIZON_SECONDS,
    }
    for (const [root, list] of Object.entries(replies)) {
      const messages = list.map((reply) => ({ id: reply.id, root, by: reply.author, at: reply.createdAt }))
      if (messages.length > 0 && fileHasUnread(messages, judge)) lit.add(root)
    }
    return lit
  }, [context, replies, me, frontier, nowSeconds])
}
