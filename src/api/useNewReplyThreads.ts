import { useMemo, useState } from 'react'
import { REPLY_FLOOR_CONTEXT, URGENT_TAG, channelContext, fileContext, threadContext } from '@estiva-app/conversation'
import { isUrgentFor } from '@/nostr/channelStreams'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { fileHasUnread, replyOnlyThread } from './fileUnread'

const HORIZON_SECONDS = PEEK_HORIZON_DAYS * 24 * 60 * 60

/** The stream a conversation's thread markers fall back to (§11.3): a DM's channel, or a file. */
export type ReplyStream = { kind: 'channel'; h: string } | { kind: 'file'; address: string }

/**
 * The stream a thread belongs to when one list holds several: a topic at All draws its files' threads beside its own,
 * and each is judged by its own file's marker (TOPI-3). Undefined or null for the conversation's own stream.
 */
export type StreamOfRoot = (root: string) => ReplyStream | null | undefined

type Message = { id: string; author: string; createdAt: number }

type Judge = Parameters<typeof fileHasUnread>[1]

const contextOf = (stream: ReplyStream) => (stream.kind === 'file' ? fileContext(stream.address) : channelContext(stream.h))

/**
 * The dot's own judge for each thread, by its root: the conversation's stream's, or the stream `streamOfRoot` names
 * for it. Undefined until the first merge has landed — an unfetched marker is not an absent one.
 */
function useStreamJudge(stream: ReplyStream | null, me: string | null, streamOfRoot?: StreamOfRoot): ((root: string) => Judge) | undefined {
  const frontier = useReadFrontier()
  // The clock places only the 90-day absent-marker horizon, so the mount's is
  // close enough — and a render must not consult `Date.now()`.
  const [nowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  const context = stream ? contextOf(stream) : undefined
  return useMemo(() => {
    if (!context || !frontier.ready) return undefined
    const judgeAt = (marker: string): Judge => ({
      file: frontier.marker(marker),
      thread: (root: string) => frontier.marker(threadContext(root)),
      floor: frontier.marker(REPLY_FLOOR_CONTEXT),
      me: me ?? undefined,
      nowSeconds,
      horizonSeconds: HORIZON_SECONDS,
    })
    const own = judgeAt(context)
    if (!streamOfRoot) return () => own
    const byContext = new Map<string, Judge>([[context, own]])
    return (root: string) => {
      const elsewhere = streamOfRoot(root)
      if (!elsewhere) return own
      const at = contextOf(elsewhere)
      if (!at) return own
      let judge = byContext.get(at)
      if (!judge) byContext.set(at, (judge = judgeAt(at)))
      return judge
    }
  }, [context, me, frontier, nowSeconds, streamOfRoot])
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
 * marker is not an absent one. A thread `streamOfRoot` places in another
 * stream is judged by that stream's marker.
 */
export function useNewReplyThreads(
  stream: ReplyStream | null,
  replies: Readonly<Record<string, readonly Message[]>> | undefined,
  me: string | null,
  streamOfRoot?: StreamOfRoot,
): ReadonlySet<string> {
  const judge = useStreamJudge(stream, me, streamOfRoot)
  return useMemo(() => {
    const lit = new Set<string>()
    if (!judge || !replies) return lit
    for (const [root, list] of Object.entries(replies)) {
      const messages = asReplies(root, list)
      if (messages.length > 0 && fileHasUnread(messages, judge(root))) lit.add(root)
    }
    return lit
  }, [judge, replies])
}

/** A message as it is drawn, with what makes it urgent: its text and its `urgent` keys. */
type DrawnMessage = Message & { body: string; urgent?: readonly string[] }

/**
 * Whether a message is urgent for the viewer — `isUrgentFor`'s rule (SPEC
 * §13.1, CON-17) over what a drawn message keeps of its event: an urgent key
 * for the viewer on a text that names them, or the old `!@`.
 */
export function isUrgentForViewer(message: { body: string; urgent?: readonly string[] }, me: string | null): boolean {
  return isUrgentFor({ content: message.body, tags: (message.urgent ?? []).map((key) => [URGENT_TAG, key]) }, me ?? undefined)
}

/**
 * Which messages of an open DM or file were new to the viewer when each was
 * first drawn — what keeps the unread look until it has been seen (Katerina,
 * 30 October). Judged once per message, by the dot's own rule (`fileHasUnread`):
 * the markers move as the conversation is read, and a message keeps its look
 * until it has been on screen, not until a marker passes it. One that arrives
 * while the conversation is open is judged as it arrives. Undefined until the
 * first merge has landed — an unfetched marker is not an absent one — and
 * nothing should be read before then, or it is judged against its own read.
 * A message in a thread `streamOfRoot` places elsewhere is judged by that
 * stream's marker (TOPI-3).
 */
export function useNewWhenDrawn(
  stream: ReplyStream | null,
  roots: readonly Message[] | undefined,
  replies: Readonly<Record<string, readonly Message[]>> | undefined,
  me: string | null,
  streamOfRoot?: StreamOfRoot,
): ReadonlySet<string> | undefined {
  const judge = useStreamJudge(stream, me, streamOfRoot)
  const key = !stream ? null : stream.kind === 'file' ? stream.address : stream.h
  const [judged, setJudged] = useState<{ key: string | null; verdicts: ReadonlyMap<string, boolean> } | undefined>()
  const verdicts = judged?.key === key ? judged.verdicts : undefined
  // Judged while drawing, React's "adjusting state when a prop changes": the look is there on the first paint.
  if (judge && roots && replies) {
    const drawn = [
      ...roots.map((root) => ({ id: root.id, root: root.id, by: root.author, at: root.createdAt })),
      ...Object.entries(replies).flatMap(([root, list]) => asReplies(root, list)),
    ]
    const fresh = drawn.filter((m) => !verdicts?.has(m.id))
    if (fresh.length > 0 || !verdicts) {
      const next = new Map(verdicts)
      for (const message of fresh) next.set(message.id, fileHasUnread([message], judge(message.root)))
      setJudged({ key, verdicts: next })
    }
  }
  return useMemo(() => verdicts && new Set([...verdicts].filter(([, isNew]) => isNew).map(([id]) => id)), [verdicts])
}

/**
 * Which threads hold a reply that is new to the viewer and urgent for them —
 * the "new reply" in its urgent tone. The same live rule as
 * `useNewReplyThreads`, over the urgent replies alone.
 */
export function useUrgentReplyThreads(
  stream: ReplyStream | null,
  replies: Readonly<Record<string, readonly DrawnMessage[]>> | undefined,
  me: string | null,
  streamOfRoot?: StreamOfRoot,
): ReadonlySet<string> {
  const judge = useStreamJudge(stream, me, streamOfRoot)
  return useMemo(() => {
    const lit = new Set<string>()
    if (!judge || !replies) return lit
    for (const [root, list] of Object.entries(replies)) {
      const urgent = list.filter((reply) => isUrgentForViewer(reply, me))
      if (urgent.length > 0 && fileHasUnread(asReplies(root, urgent), judge(root))) lit.add(root)
    }
    return lit
  }, [judge, replies, me])
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
  streamOfRoot?: StreamOfRoot,
): string | null | undefined {
  const judge = useStreamJudge(stream, me, streamOfRoot)
  return useMemo(() => {
    if (!judge || !roots || !replies) return undefined
    const top = roots.map((root) => ({ id: root.id, root: root.id, by: root.author, at: root.createdAt }))
    const threads = Object.fromEntries(Object.entries(replies).map(([root, list]) => [root, asReplies(root, list)]))
    return replyOnlyThread(top, threads, judge)
  }, [judge, roots, replies])
}
