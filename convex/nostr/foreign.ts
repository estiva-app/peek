'use node'

/**
 * Convex wiring for rendering another app's objects.
 *
 * All the logic lives in `projection.ts`, which takes a query function and
 * knows nothing about Convex — so it can be run against a live relay without a
 * deployment. This file supplies the authenticated bridge and nothing else.
 */
import { v } from 'convex/values'
import { action, type ActionCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import { queryEvents, relayUrl } from './bridge'
import { decryptSecretKey } from './keys'
import {
  resolveFolderProject,
  resolveForeignObject,
  type FolderProject,
  type ForeignObject,
  type QueryFn,
} from './projection'

/**
 * A relay read, authenticated as a real Peek user.
 *
 * The read borrows a member's identity, matching `sync.ts`: the bridge is
 * NIP-98 gated on every route including reads, and a service identity would
 * have to be a member of every Folder to read private ones. Borrowing is both
 * simpler and more correct about permissions.
 *
 * Null when publishing is off or no local user holds a key. Both callers treat
 * that as "nothing to show" rather than as an error.
 */
async function readerQuery(ctx: ActionCtx): Promise<QueryFn | null> {
  if (!relayUrl()) return null

  const users = await ctx.runQuery(internal.nostr.data.listLocalUsersWithKeys, {})
  const reader = users.find((u: any) => u.nostrPubkey && u.nostrSecretKey)
  if (!reader) return null
  const auth = {
    pubkey: reader.nostrPubkey,
    secretKeyHex: await decryptSecretKey(reader.nostrSecretKey),
  }

  return async (filters) => {
    const { events } = await queryEvents(filters, auth)
    return events
  }
}

/**
 * Resolve a `nostr:naddr…` into a renderable widget.
 *
 * Returns `null` when publishing is off, no key is available, or the reference
 * cannot be resolved — a broken reference in a chat message should degrade to
 * plain text rather than break the message.
 */
export const resolveObject = action({
  args: { naddr: v.string() },
  handler: async (ctx, { naddr }): Promise<ForeignObject | null> => {
    const query = await readerQuery(ctx)
    if (!query) return null
    return resolveForeignObject(naddr, query)
  },
})

/**
 * The project in a Folder, for the topic sidebar (PEEK-24).
 *
 * Takes the Folder rather than a reference because a topic already has one: the
 * topic and the project are the same container, so nobody has to paste anything
 * for Peek to know which project a topic is about.
 *
 * `null` means "no project here", which is a state the sidebar draws as an
 * empty panel — the topic simply has no tracker attached, and that is normal.
 */
export const projectForFolder = action({
  args: { folder: v.string() },
  handler: async (ctx, { folder }): Promise<FolderProject | null> => {
    const query = await readerQuery(ctx)
    if (!query) return null
    return resolveFolderProject(folder, query)
  },
})
