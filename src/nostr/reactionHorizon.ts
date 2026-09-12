/**
 * The reaction-target horizon — SPEC §6.6.
 *
 * A `kind:7` carries no `h` tag, so reactions are fetched addressed by target,
 * and a client has to choose how many targets to ask about. **N is 100, and it
 * is the same in every app**: two apps showing one conversation with different
 * N disagree about the count legitimately and unfixably, which a reader cannot
 * tell from a bug. Ship's `REACTION_TARGET_LIMIT` is the same number for the
 * same reason.
 *
 * One module for both halves of Peek. `convex/nostr/sync.ts` applies the cap
 * when it builds the target list; the caption that reports the cap
 * (`ReactionHorizon`) names it. Two copies of the number would be two places
 * for it to drift, and the caption would then say something the sync did not
 * do.
 */
export const REACTION_TARGET_LIMIT = 100
