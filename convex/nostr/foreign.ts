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
import { queryEvents, relayUrl, type RelayAuth } from './bridge'
import { internal } from '../_generated/api'
import {
  resolveFolderProject,
  resolveForeignObject,
  type FolderProject,
  type ForeignObject,
  type QueryFn,
} from './projection'

/**
 * How foreign-object reads authenticate to the relay.
 *
 * As the **signed-in viewer**, always. The relay is NIP-98 gated on every route
 * and answers a non-member with `403 relay_membership_required`, so the person
 * looking at the object is the only identity guaranteed to see it — the same
 * reason `syncTopicAsViewer` exists.
 *
 * Without a token there is nothing to fall back to: Peek holds no keys, and a
 * service credential would be a member of nothing. Returning null is the honest
 * answer, and the caller degrades to an unresolved reference.
 */
async function readerQuery(_ctx: ActionCtx, estivaIdToken?: string): Promise<QueryFn | null> {
  if (!relayUrl() || !estivaIdToken) return null

  // The `sub` claim is the pubkey. `/sign` overwrites whatever we send anyway,
  // so a token we cannot parse still signs correctly — it just cannot be
  // cross-checked against the author we expected.
  let pubkey: string | null = null
  try {
    const payload = estivaIdToken.split('.')[1]
    if (payload) {
      const json = JSON.parse(
        Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
      ) as { sub?: string }
      pubkey = json.sub ?? null
    }
  } catch {
    // Unparseable token: let `/sign` be the judge of it.
  }

  const auth: RelayAuth = { pubkey, token: estivaIdToken }
  return async (filters) => (await queryEvents(filters, auth)).events
}
/**
 * Resolve a `nostr:naddr…` into a renderable widget.
 *
 * Returns `null` when publishing is off, no key is available, or the reference
 * cannot be resolved — a broken reference in a chat message should degrade to
 * plain text rather than break the message.
 */
export const resolveObject = action({
  args: { naddr: v.string(), estivaIdToken: v.optional(v.string()) },
  handler: async (ctx, { naddr, estivaIdToken }): Promise<ForeignObject | null> => {
    const query = await readerQuery(ctx, estivaIdToken)
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
 *
 * Accepts an optional `estivaIdToken` to authenticate relay reads as the signed-in
 * user (matching Ship's auth model). Falls back to backend credentials if not provided.
 */
export const projectForFolder = action({
  args: { 
    folder: v.string(),
    estivaIdToken: v.optional(v.string())
  },
  handler: async (ctx, { folder, estivaIdToken }): Promise<FolderProject | null> => {
    console.log(`[TRACE] projectForFolder: called with folder=${folder}, estivaIdToken=${estivaIdToken ? 'present' : 'absent'}`)
    const query = await readerQuery(ctx, estivaIdToken)
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
