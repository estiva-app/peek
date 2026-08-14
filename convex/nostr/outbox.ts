/**
 * Unsigned events out, event ids back in (PEEK-106).
 *
 * The half of publishing that Convex keeps once signing moves to the browser.
 * Splitting it this way is not a stylistic choice: the browser holds the only
 * Estiva ID token, and Convex holds the only copy of the rows an event is built
 * from. Neither can do the job alone, so the boundary runs between shaping the
 * event and signing it:
 *
 *   1. **here** — build the *unsigned* event from Peek's rows. No credential is
 *      needed to shape one, so no credential is passed
 *   2. the browser — sign via `/sign` and POST to the bridge
 *   3. **here** — record the event id, which is a fact rather than a secret
 *
 * Default runtime on purpose. `publish.ts` is `"use node"` and may therefore
 * only export actions, which is what forced every publish to *be* an action —
 * and an action is exactly what cannot receive a token without it appearing in
 * Convex's dashboard logs. Queries and mutations have no such problem.
 *
 * Authorship is checked here as well as at `/sign`. `/sign` would refuse to
 * sign as anyone but the token's subject anyway, but a refusal here says so
 * plainly instead of surfacing later as a signature mismatch.
 */
import { v } from 'convex/values'
import { mutation, query } from '../_generated/server'
import { buildMessage } from './events'
import { referencedAddresses, withinDriftWindow } from './refs'
import { viewerId } from '../users'
import type { UnsignedEvent } from './events'

/**
 * Why a message cannot be published, or the event that would publish it.
 *
 * A discriminated result rather than `null`, because every reason here is one
 * a caller may legitimately hit and none of them is an error: an already-published
 * row, a DM, a message older than the relay's window. Returning `null` for all
 * of them is what turns "nothing happened" into something nobody can debug.
 */
export type UnsignedMessage =
  | { ok: true; unsigned: UnsignedEvent; alreadyPublished?: undefined }
  | { ok: false; reason: string }

export const unsignedMessage = query({
  args: { messageId: v.id('messages') },
  handler: async (ctx, { messageId }): Promise<UnsignedMessage> => {
    const m = await ctx.db.get(messageId)
    if (!m) return { ok: false, reason: 'unknown message' }
    // Only topic messages publish: DMs need NIP-17 gift wrap and huddles have
    // no Buzz container.
    if (m.parentKind !== 'topic') return { ok: false, reason: 'not a topic message' }
    // Idempotent — never publish the same row twice.
    if (m.nostrEventId) return { ok: false, reason: 'already published' }

    const me = await viewerId(ctx)
    if (!me || me !== m.authorId) return { ok: false, reason: 'only the author may publish their message' }

    // Checked before signing so an old row costs nothing and the reason is
    // legible, rather than arriving as the relay's generic drift rejection.
    if (!withinDriftWindow(m.createdAt)) {
      return { ok: false, reason: 'outside the relay drift window' }
    }

    const topicId = ctx.db.normalizeId('topics', m.parentId)
    const topic = topicId ? await ctx.db.get(topicId) : null
    if (!topic) return { ok: false, reason: 'unknown topic' }
    // The happy path assumes the channel exists. It is created by
    // `publishTopicAsCreator` when the topic is made, and deliberately by the
    // topic's *creator* — publishing it as whoever spoke first would make the
    // wrong person its owner.
    if (!topic.channelUuid) return { ok: false, reason: 'the topic has no channel on the relay yet' }

    const author = await ctx.db.get(m.authorId)
    if (!author?.nostrPubkey) return { ok: false, reason: 'author has no Estiva ID pubkey' }

    return {
      ok: true,
      unsigned: buildMessage(author.nostrPubkey, m.createdAt, {
        channelUuid: topic.channelUuid,
        content: m.body,
        about: referencedAddresses(m.body),
      }),
    }
  },
})

/**
 * Record that the relay accepted this message.
 *
 * Viewer-gated even though an event id is not a secret: without the check any
 * signed-in user could stamp an arbitrary id onto someone else's row, and every
 * later deletion and reply would then point at the wrong event.
 */
export const recordMessagePublished = mutation({
  args: { messageId: v.id('messages'), nostrEventId: v.string() },
  handler: async (ctx, { messageId, nostrEventId }) => {
    const m = await ctx.db.get(messageId)
    if (!m) return
    const me = await viewerId(ctx)
    if (!me || me !== m.authorId) return
    await ctx.db.patch(messageId, { nostrEventId, nostrPublishedAt: Date.now() })
  },
})
