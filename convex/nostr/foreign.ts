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
import { queryEvents, relayUrl, serviceIdentity, type RelayAuth } from './bridge'
import { internal } from '../_generated/api'
import { maybeDecryptSecretKey } from './keys'
import {
  resolveFolderProject,
  resolveForeignObject,
  type FolderProject,
  type ForeignObject,
  type QueryFn,
} from './projection'

/**
 * A relay read authenticated by the backend's identity-service credential.
 *
 * The relay is NIP-98 gated on all routes, but the call path no longer depends on
 * decrypting a user secret at all.
 */
async function readerQuery(_ctx: ActionCtx): Promise<QueryFn | null> {
  if (!relayUrl()) return null

  const serviceAuth = await serviceIdentity()
  const locals = await _ctx.runQuery(internal.nostr.data.listLocalUsersWithKeys, {})
  const localAuth: RelayAuth | null = locals?.[0]
    ? {
        pubkey: locals[0].nostrPubkey,
        secretKeyHex: await maybeDecryptSecretKey(locals[0].nostrSecretKey),
      }
    : null

  const auth = serviceAuth ?? localAuth
  if (!auth) return null

  return async (filters) => {
    const primary = await queryEvents(filters, auth)
    if (primary.ok || !serviceAuth || !localAuth) return primary.events
    const fallback = await queryEvents(filters, localAuth)
    return fallback.events
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
    console.log(`[TRACE] projectForFolder: called with folder=${folder}`)
    const query = await readerQuery(ctx)
    console.log(`[TRACE] projectForFolder: query=${query ? 'available' : 'null'}`)
    if (!query) {
      console.log(`[TRACE] projectForFolder: returning null due to no query`)
      return null
    }
    const result = await resolveFolderProject(folder, query)
    console.log(`[TRACE] projectForFolder: resolveFolderProject returned ${result ? 'project' : 'null'}`)
    if (result) {
      console.log(`[TRACE] projectForFolder: result has ${result.tickets.length} tickets, openCount=${result.openCount}`)
    }
    return result
  },
})
