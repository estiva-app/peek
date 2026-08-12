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
import { queryEvents, relayUrl, serviceIdentity } from './bridge'
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

  const auth = await serviceIdentity()
  if (!auth) return null

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
