import { REACTION_TARGET_LIMIT } from '@/nostr/reactionHorizon'

/**
 * The reaction horizon, said out loud — SPEC §6.6, PEE-21.
 *
 * A reaction is fetched addressed by target, and Peek asks about at most
 * `REACTION_TARGET_LIMIT` messages and replies per topic. Past that, a message
 * with reactions looks exactly like a message nobody reacted to — §6.6's
 * finding, and why reporting the cap is a MUST rather than a SHOULD. On this
 * workspace it has never bitten (the busiest container holds 77 against a cap
 * of 100), which is precisely why the line has to exist before it does.
 *
 * One line per container, drawn once under the stream, in the caption voice:
 * it is an explanation, not a warning — nothing went wrong, and there is
 * nothing for the reader to do about it. Ship draws the same line under an
 * issue's thread with the same two tokens, so a person using both apps reads
 * one explanation.
 *
 * `omitted` is what the last sync recorded on the container (`importChannel`
 * counts it; `topics.list` carries a topic's and `syncPlan` a DM's). "Older" is
 * true whichever way the shared budget split — each side keeps its newest — and
 * the caption does not say how the split went, because that is the sync's
 * business.
 *
 * `container` names what the reader is looking at. The cap is per container and
 * a DM has one too since DMS-5, so the line has to be able to say which — "in
 * this topic" under a DM would be wrong in the one place the reader is relying
 * on it to be exact.
 */
export function ReactionHorizon({
  omitted,
  container = 'topic',
}: {
  omitted: number
  container?: 'topic' | 'conversation'
}) {
  if (omitted <= 0) return null
  return (
    <p className="text-caption text-text-muted">
      Reactions are shown for {REACTION_TARGET_LIMIT} messages and replies in this {container}.{' '}
      {omitted} older {omitted === 1 ? 'one was' : 'ones were'} not checked.
    </p>
  )
}
