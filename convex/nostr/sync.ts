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

/**
 * How many of a channel's newest messages to check for reactions each run.
 *
 * Reactions have no cursor (see `listMessageEventIdsForTopic`), so this is a
 * deliberate trade: reactions on messages older than the newest N are not
 * picked up. Fine for a PoC; a real implementation would subscribe over
 * WebSocket instead of re-querying by target.
 */
const REACTION_TARGET_LIMIT = 100

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

/**
 * The event this kind:9 is replying to, or null if it is top-level.
 *
 * Reads the NIP-10 marked form Buzz emits: prefer the `"reply"`-marked tag, fall
 * back to `"root"`. A direct reply in Buzz carries only the `"reply"` marker
 * (`thread_tags`, builders.rs:173), so checking for `"root"` alone would miss
 * every direct reply.
 */
function replyTargetOf(e: SignedEvent): string | null {
  const eTags = e.tags.filter((t) => t[0] === 'e' && typeof t[1] === 'string')
  if (eTags.length === 0) return null
  const marked = (marker: string) => eTags.find((t) => t[3] === marker)?.[1]
  return marked('reply') ?? marked('root') ?? eTags[0][1] ?? null
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
 * Import foreign reactions on a set of known events, and apply retractions.
 *
 * Two queries because kind:7 and kind:5 are addressed differently from kind:9:
 * neither carries an `h` tag, so both are filtered by the events they target.
 */
async function syncReactions(
  ctx: { runQuery: any; runMutation: any },
  reader: Reader,
  targetEventIds: string[],
  isLocal: Set<string>,
  known: string[],
): Promise<void> {
  const reactions = await queryEvents(
    [{ kinds: [7], '#e': targetEventIds, limit: PAGE_LIMIT }],
    reader,
  )
  if (!reactions.ok) return

  for (const e of reactions.events.filter((r) => !isLocal.has(r.pubkey))) {
    const targetId = e.tags.find((t) => t[0] === 'e')?.[1]
    if (!targetId) continue
    const target = await ctx.runQuery(internal.nostr.data.messageByNostrEventId, {
      nostrEventId: targetId,
    })
    if (!target) continue
    const userId: Id<'users'> = await ctx.runMutation(
      internal.nostr.data.resolveExternalUser,
      { nostrPubkey: e.pubkey },
    )
    await ctx.runMutation(internal.nostr.data.importReaction, {
      messageId: target.messageId,
      userId,
      // NIP-25 puts the emoji in content. `+`/`-` are the plain like/dislike
      // form; Peek has no concept of those, so they are stored verbatim rather
      // than guessed at.
      emoji: e.content,
      createdAt: e.created_at * 1000,
      nostrEventId: e.id,
    })
  }

  // Retractions are checked against the reactions Peek ALREADY HOLDS, not the
  // ones just fetched: once the relay has a kind:5 for an event it stops
  // returning that event, so a deleted reaction is absent from `reactions.events`
  // and asking about those ids could never find its deletion.
  if (known.length === 0) return
  const deletions = await queryEvents([{ kinds: [5], '#e': known, limit: PAGE_LIMIT }], reader)
  if (!deletions.ok) return
  for (const d of deletions.events) {
    for (const t of d.tags.filter((tag) => tag[0] === 'e' && known.includes(tag[1]))) {
      // The relay already enforces self-authored deletion, so by the time an
      // event is here it is legitimate. Re-verifying authorship locally is not
      // possible anyway: the reaction it targets may no longer be fetchable.
      await ctx.runMutation(internal.nostr.data.removeReactionByNostrEventId, {
        nostrEventId: t[1],
      })
    }
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
          // kind:7 has no `h` tag (Buzz derives its channel from the target),
          // so reactions are fetched separately below.
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

            // A kind:9 carrying a NIP-10 `e` tag is a reply, not a top-level
            // message — Peek keeps those in a different table.
            const parentEventId = replyTargetOf(e)
            if (parentEventId) {
              const parent = await ctx.runQuery(internal.nostr.data.messageByNostrEventId, {
                nostrEventId: parentEventId,
              })
              if (!parent) {
                // Parent not imported (yet, or ever). Skipping is right: Peek's
                // replies table requires a messageId, and inventing one would
                // strand the reply under the wrong message.
                continue
              }
              await ctx.runMutation(internal.nostr.data.importReply, {
                messageId: parent.messageId,
                authorId,
                body: e.content,
                createdAt: e.created_at * 1000,
                nostrEventId: e.id,
              })
              continue
            }

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

        // Reactions are fetched by TARGET, not by channel or cursor: kind:7 has
        // no `h` tag, and its `created_at` bears no relation to the message it
        // targets, so the channel cursor never reaches it.
        //
        // The targets must be every message Peek holds in this channel — using
        // only the events from this sync window meant a reaction on any older
        // message was silently never imported (found by testing, not reading).
        const targets: string[] = await ctx.runQuery(
          internal.nostr.data.listMessageEventIdsForTopic,
          { topicId: topic.topicId, limit: REACTION_TARGET_LIMIT },
        )
        if (targets.length > 0) {
          const known: string[] = await ctx.runQuery(
            internal.nostr.data.listReactionEventIdsForTopic,
            { topicId: topic.topicId, limit: PAGE_LIMIT },
          )
          await syncReactions(ctx, reader, targets, isLocal, known)
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
