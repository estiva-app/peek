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
 * `omitted` is what the last sync recorded on the topic (`importChannel`
 * counts it; `topics.list` carries it). "Older" is true whichever way the
 * shared budget split — each side keeps its newest — and the caption does not
 * say how the split went, because that is the sync's business.
 */
export function ReactionHorizon({ omitted }: { omitted: number }) {
  if (omitted <= 0) return null
  return (
    <p className="text-caption text-text-muted">
      Reactions are shown for {REACTION_TARGET_LIMIT} messages and replies in this topic. {omitted} older{' '}
      {omitted === 1 ? 'one was' : 'ones were'} not checked.
    </p>
  )
}
