'use node'

/**
 * Stage 2 read path: project relay events back into Convex.
 *
 * This is what makes interop two-way. Without it Peek publishes into the
 * ecosystem but cannot see anything anyone else writes.
 *
 * **Polling, not subscribing.** Convex functions are request-scoped and cannot
 * hold a WebSocket, so this polls the HTTP bridge instead of opening a NIP-01
 * REQ subscription. Real-time later means a small external consumer holding the
 * socket and pushing into Convex; nothing here needs to change for that.
 *
 * Requires an identity to authenticate the read — the bridge is NIP-98 gated on
 * every route, reads included.
 */
import { v } from 'convex/values'
import { internalAction } from '../_generated/server'
import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import { queryEvents, relayUrl } from './bridge'
import { decryptSecretKey } from './keys'
import type { SignedEvent } from './events'

/** Cap per topic per run so one busy channel cannot starve the others. */
const PAGE_LIMIT = 200

interface Reader {
  pubkey: string
  secretKeyHex: string
}

/**
 * Any Peek user with a keypair can authenticate the read.
 *
 * A dedicated service identity would be tidier, but it would also need to be a
 * member of every channel to read private ones — so borrowing a real member's
 * identity is both simpler and more correct about permissions.
 */
async function readerIdentity(ctx: { runQuery: any }): Promise<Reader | null> {
  const users = await ctx.runQuery(internal.nostr.data.listLocalUsersWithKeys, {})
  const withKeys = users.find((u: any) => u.nostrPubkey && u.nostrSecretKey)
  if (!withKeys) return null
  return {
    pubkey: withKeys.nostrPubkey,
    secretKeyHex: await decryptSecretKey(withKeys.nostrSecretKey),
  }
}

/** kind:0 content → display name, tolerating anything malformed. */
function displayNameFrom(profile: SignedEvent | undefined): string | undefined {
  if (!profile) return undefined
  try {
    const meta = JSON.parse(profile.content)
    return typeof meta.display_name === 'string' && meta.display_name
      ? meta.display_name
      : typeof meta.name === 'string' && meta.name
        ? meta.name
        : undefined
  } catch {
    return undefined
  }
}

/**
 * Poll every known channel and import messages authored by identities Peek does
 * not own.
 *
 * Peek's own published messages are deliberately skipped: they already exist as
 * rows, and importing them would both duplicate and race the publish path's
 * `nostrEventId` write-back. Only foreign events are projected — which is
 * exactly the interop surface.
 */
export const syncChannels = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!relayUrl()) return

    const reader = await readerIdentity(ctx)
    if (!reader) return // nobody has published yet, so there is nothing to read as

    const localPubkeys: string[] = await ctx.runQuery(internal.nostr.data.listLocalPubkeys, {})
    const isLocal = new Set(localPubkeys)

    const topics: { topicId: Id<'topics'>; channelUuid: string; since: number | null }[] =
      await ctx.runQuery(internal.nostr.data.listSyncableTopics, {})

    for (const topic of topics) {
      try {
        const filter: Record<string, unknown> = {
          kinds: [9],
          '#h': [topic.channelUuid],
          limit: PAGE_LIMIT,
        }
        // `since` is inclusive, so the newest already-seen event comes back
        // again. That is intentional — dropping it risks missing a second event
        // sharing the same one-second timestamp, and the event-id check makes
        // the re-read free.
        if (topic.since !== null) filter.since = topic.since

        const { ok, events, reason } = await queryEvents([filter], reader)
        if (!ok) {
          console.warn(`[nostr] sync query failed for ${topic.channelUuid}: ${reason}`)
          continue
        }

        const foreign = events.filter((e) => !isLocal.has(e.pubkey))
        if (foreign.length > 0) {
          // One profile lookup per run, not per message.
          const authors = [...new Set(foreign.map((e) => e.pubkey))]
          const profiles = await queryEvents([{ kinds: [0], authors, limit: authors.length }], reader)
          const nameByPubkey = new Map<string, string | undefined>()
          for (const pk of authors) {
            nameByPubkey.set(
              pk,
              displayNameFrom(profiles.events.find((p) => p.pubkey === pk)),
            )
          }

          for (const e of foreign) {
            const authorId: Id<'users'> = await ctx.runMutation(
              internal.nostr.data.resolveExternalUser,
              { nostrPubkey: e.pubkey, displayName: nameByPubkey.get(e.pubkey) },
            )
            await ctx.runMutation(internal.nostr.data.importMessage, {
              topicId: topic.topicId,
              authorId,
              body: e.content,
              // Nostr seconds → Peek milliseconds.
              createdAt: e.created_at * 1000,
              nostrEventId: e.id,
            })
          }
        }

        // Advance on ALL events seen, not just imported ones — otherwise a
        // channel containing only Peek's own messages would re-read them
        // forever.
        if (events.length > 0) {
          await ctx.runMutation(internal.nostr.data.setTopicSyncCursor, {
            topicId: topic.topicId,
            nostrSyncedAt: Math.max(...events.map((e) => e.created_at)),
          })
        }
      } catch (e) {
        console.warn(`[nostr] sync failed for channel ${topic.channelUuid}:`, e)
      }
    }
  },
})

/** Manual trigger, for testing without waiting for the cron. */
export const syncNow = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    await ctx.runAction(internal.nostr.sync.syncChannels, {})
    return 'sync complete'
  },
})
