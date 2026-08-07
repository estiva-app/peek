/**
 * Temporary probe for PEEK-29 — delete once the answer is recorded.
 *
 * Nothing in `convex/` calls `getUserIdentity()` today, so there is currently no
 * way to observe whether Convex accepted a token at all. This returns what
 * Convex made of the caller's credentials, which is the only thing that can
 * settle the ticket:
 *
 *   * `null`           — no token, or Convex rejected it
 *   * `{ subject: … }` — accepted, and `subject` should be the user's Nostr
 *                        pubkey, because Estiva ID sets `sub` to exactly that
 *
 * It deliberately returns no application data, so it is safe to leave deployed
 * for as long as the question takes to answer.
 */
import { query } from './_generated/server'

export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    return {
      subject: identity.subject,
      issuer: identity.issuer,
      tokenIdentifier: identity.tokenIdentifier,
    }
  },
})
