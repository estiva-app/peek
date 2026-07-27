'use node'

/**
 * Convex wiring for rendering another app's objects.
 *
 * All the logic lives in `projection.ts`, which takes a query function and
 * knows nothing about Convex — so it can be run against a live relay without a
 * deployment. This file supplies the authenticated bridge and nothing else.
 */
import { v } from 'convex/values'
import { action } from '../_generated/server'
import { internal } from '../_generated/api'
import { queryEvents, relayUrl } from './bridge'
import { decryptSecretKey } from './keys'
import { resolveForeignObject, type ForeignObject } from './projection'

/**
 * Resolve a `nostr:naddr…` into a renderable widget.
 *
 * Returns `null` when publishing is off, no key is available, or the reference
 * cannot be resolved — a broken reference in a chat message should degrade to
 * plain text rather than break the message.
 *
 * The read is authenticated as a real Peek user, matching `sync.ts`: the bridge
 * is NIP-98 gated on every route including reads, and a service identity would
 * have to be a member of every Folder to read private ones. Borrowing a member's
 * identity is both simpler and more correct about permissions.
 */
export const resolveObject = action({
  args: { naddr: v.string() },
  handler: async (ctx, { naddr }): Promise<ForeignObject | null> => {
    if (!relayUrl()) return null

    const users = await ctx.runQuery(internal.nostr.data.listLocalUsersWithKeys, {})
    const reader = users.find((u: any) => u.nostrPubkey && u.nostrSecretKey)
    if (!reader) return null
    const auth = {
      pubkey: reader.nostrPubkey,
      secretKeyHex: await decryptSecretKey(reader.nostrSecretKey),
    }

    return resolveForeignObject(naddr, async (filters) => {
      const { events } = await queryEvents(filters, auth)
      return events
    })
  },
})
