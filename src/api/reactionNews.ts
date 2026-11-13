/**
 * A reaction to your message on a row (ACT-7; SPEC §11.8): which reactions are new in a row's conversation, as card
 * lines, the colour the row's dot takes, and what showing them writes. Pure: the reactions come in from
 * `useReactionsToMe`, the markers from the read frontier.
 *
 * - **New** is the shared rule's (`newReactionsIn`): judged with the same following, mute and start the row's blue dot
 *   uses, and later than the conversation's `reactions:` key. Not following, or muted: none.
 * - **Blue wins** (Miky, 10 Nov): a row with anything blue shows one blue dot and its card lists the reaction too; the
 *   dot is orange only when the row's only news is reactions to you.
 * - **Seen once, in its conversation**: the key is the conversation's, so seeing a reaction on one row clears it on
 *   every row that draws that conversation (two topics listing one file, the file's Desk row).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reaction-is-seen-once-in-its-conversation.md
 */
import { channelContext, fileContext, fileIdContext, newReactionsIn, reactionsSeenWrites, type ReactionJudge, type ReactionToMe } from '@estiva-app/conversation'
import { fileIdOf } from '@estiva-app/protocol'
import type { UnreadDotTone } from '@estiva-app/ui'
import { rootOf } from '@/nostr/channelStreams'
import type { RowNewsItem } from './rowNews'
import type { ReactionsToMe } from './useReactionsToMe'

/** The §11.1 contexts a conversation is known by: a file's address and its `file:<d>`, or a channel's uuid. */
export function streamContextsOf(place: string | null | undefined): string[] {
  const file = fileContext(place ?? undefined)
  if (file) {
    const byId = fileIdContext(fileIdOf(file))
    return byId ? [file, byId] : [file]
  }
  const channel = channelContext(place ?? undefined)
  return channel ? [channel] : []
}

/** The reactions to you in a conversation known by `contexts`, newest first. */
export function reactionsIn(source: ReactionsToMe, contexts: readonly string[]): ReactionToMe[] {
  const byId = new Map<string, ReactionToMe>()
  for (const context of contexts) for (const reaction of source.byContext.get(context) ?? []) byId.set(reaction.id, reaction)
  return [...byId.values()].sort((a, b) => b.at - a.at)
}

/** A reaction as a card line: who reacted with what, the message it is on (its words, and the thread it opens at). */
export function reactionLine(reaction: ReactionToMe, source: ReactionsToMe, file?: string): RowNewsItem {
  const target = source.targetOf.get(reaction.target)
  return {
    id: reaction.id,
    by: reaction.by,
    at: reaction.at,
    reason: 'reaction',
    root: target ? rootOf(target) : reaction.target,
    words: target?.content ?? '',
    reaction: { emoji: reaction.emoji, target: reaction.target, contexts: source.streamOf.get(reaction.id) ?? [] },
    ...(file ? { file } : {}),
  }
}

/**
 * The new reactions to you in one conversation (`place`: a file's address or a channel's uuid), as card lines, newest
 * first. `judge` is how the viewer is in it, as the row's blue dot judges: a place's following and mute, or, for a DM or
 * a stream the viewer is a member of, `following: null` and their start. `file` names a listed file's lines.
 */
export function reactionNews(
  source: ReactionsToMe,
  place: string | null | undefined,
  merged: Readonly<Record<string, number>>,
  judge: Omit<ReactionJudge, 'contexts'>,
  file?: string,
): RowNewsItem[] {
  if (!source.ready) return []
  const contexts = streamContextsOf(place)
  const found = reactionsIn(source, contexts)
  if (found.length === 0) return []
  return newReactionsIn(found, merged, { ...judge, contexts }).map((reaction) => reactionLine(reaction, source, file))
}

/**
 * The row's dot colour: `reaction` only when every line is a reaction to you; anything blue makes it one blue dot
 * (Miky, 10 Nov), and its card lists the reaction too.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reaction-is-seen-once-in-its-conversation.md
 */
export function unreadToneOf(items: readonly RowNewsItem[] | undefined): UnreadDotTone {
  return items && items.length > 0 && items.every((item) => item.reaction) ? 'reaction' : 'blue'
}

/** What showing these lines writes: per conversation, its `reactions:` key at the newest reaction shown (never the clock). */
export function reactionsSeenOf(items: readonly RowNewsItem[]): { context: string; atMs: number }[] {
  return reactionsSeenWrites(
    items.flatMap((item) =>
      item.reaction ? [{ reaction: { id: item.id, by: item.by, at: item.at, emoji: item.reaction.emoji, target: item.reaction.target }, contexts: item.reaction.contexts }] : [],
    ),
  )
}
