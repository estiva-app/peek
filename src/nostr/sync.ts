/**
 * Reading a channel off the relay, from the browser (PEEK-106).
 *
 * The projection itself stays in Convex — it is intricate, it belongs next to
 * the database, and none of it needs a credential. What moves here is only the
 * *reading*, because the relay is NIP-98 gated on every route and the viewer's
 * token is the only credential that can see their channels.
 *
 * So a sync run is: ask Convex what to fetch, fetch it, hand the events back.
 *
 * **Two round trips, not one, and the order is load-bearing.** Reactions are
 * addressed by target rather than by channel or cursor — kind:7 carries no `h`
 * tag — so the browser cannot know which events to ask about until the messages
 * have been imported. `importChannel` returns those targets, which is also what
 * lets a message that arrived in this same run still receive its reactions.
 *
 * Failures are logged and swallowed. A relay that is down must leave the app
 * working off its Convex rows, exactly as before.
 */
import type { StoredToken } from '@/auth/estivaId'
import { queryRelay } from './bridge'
import { KIND } from '../../convex/nostr/events'

/** Cap per run so one busy channel cannot dominate. Mirrors the old server-side
 *  `PAGE_LIMIT`; the relay applies it, so it has to match to page identically. */
const PAGE_LIMIT = 200

type SyncApi = {
  syncPlan: (args: { topicKey: string }) => Promise<{ channelUuid: string; since: number | null } | null>
  importChannel: (args: {
    topicKey: string
    events: unknown[]
    profiles: unknown[]
  }) => Promise<{
    ok: boolean
    targets?: string[]
    known?: string[]
    deletable?: string[]
    reason?: string
  }>
  importReactions: (args: {
    topicKey: string
    reactions: unknown[]
    deletions: unknown[]
    known: string[]
    deletable: string[]
  }) => Promise<{ ok: boolean; reason?: string }>
  importResolutions: (args: {
    topicKey: string
    assertions: unknown[]
  }) => Promise<{ ok: boolean; imported?: number; reason?: string }>
}

export async function syncTopicFromRelay(
  topicKey: string,
  relayUrl: string,
  token: StoredToken,
  api: SyncApi,
): Promise<void> {
  const plan = await api.syncPlan({ topicKey })
  if (!plan) return // no channel on the relay yet, or not signed in

  const filter: Record<string, unknown> = {
    // kind:7 has no `h` tag (Buzz derives its channel from the target), so
    // reactions are fetched separately below.
    //
    // `1111` is NIP-22, and it is here because Ship's comments are moving to it
    // (REW-10). A Ship comment is posted into the project's Folder — which *is*
    // this topic's channel — so it has always arrived here as an ordinary
    // message, and the whole "one container, many projections" claim rests on
    // that. Asking only for `9` would have made those comments vanish from the
    // topic the day Ship flipped: no error, no empty state, just a conversation
    // that stops.
    //
    // Both kinds, permanently. A `kind:9` message is not replaceable at all, so
    // every comment written before the flip stays `kind:9` forever and there is
    // no migration that would let this list shrink later.
    kinds: [KIND.STREAM_MESSAGE, KIND.COMMENT],
    '#h': [plan.channelUuid],
    limit: PAGE_LIMIT,
  }
  // `since` is inclusive, so the newest already-seen event comes back again.
  // That is intentional — dropping it risks missing a second event sharing the
  // same one-second timestamp, and the event-id check makes the re-read free.
  if (plan.since !== null) filter.since = plan.since

  const messages = await queryRelay(relayUrl, [filter], token.accessToken, token.pubkey)
  if (!messages.ok) {
    // `relay_membership_required` here means the viewer is not a member of this
    // channel, which is a real answer rather than an error.
    console.warn(`[nostr] sync read failed for ${plan.channelUuid}: ${messages.reason}`)
    return
  }

  // One profile lookup per run, not per message.
  const authors = [...new Set(messages.events.map((e) => e.pubkey))]
  const profiles =
    authors.length > 0
      ? await queryRelay(
          relayUrl,
          [{ kinds: [0], authors, limit: authors.length }],
          token.accessToken,
          token.pubkey,
        )
      : { ok: true as const, events: [] }

  const imported = await api.importChannel({
    topicKey,
    events: messages.events,
    profiles: profiles.ok ? profiles.events : [],
  })
  if (!imported.ok) {
    console.warn('[nostr] importChannel failed:', imported.reason)
    return
  }

  const targets = imported.targets ?? []
  const known = imported.known ?? []
  const deletable = imported.deletable ?? []

  const reactions =
    targets.length > 0
      ? await queryRelay(
          relayUrl,
          [{ kinds: [7], '#e': targets, limit: PAGE_LIMIT }],
          token.accessToken,
          token.pubkey,
        )
      : { ok: true as const, events: [] }

  // Retractions are asked about by the ids Peek ALREADY HOLDS, never by the
  // events just fetched: once the relay has a kind:5 for an event it stops
  // returning that event, so a deleted one is absent from every fetch above and
  // asking about those ids could never find its own deletion.
  //
  // One query for both kinds of target. `known` is the reactions, `deletable`
  // is the messages and replies (PEEK-113) — a kind:5 looks identical either
  // way, so splitting this in two would only cost a round trip.
  const retractable = [...known, ...deletable]
  const deletions =
    retractable.length > 0
      ? await queryRelay(
          relayUrl,
          [{ kinds: [5], '#e': retractable, limit: PAGE_LIMIT }],
          token.accessToken,
          token.pubkey,
        )
      : { ok: true as const, events: [] }

  if (!reactions.ok && !deletions.ok) return

  await api.importReactions({
    topicKey,
    reactions: reactions.ok ? reactions.events : [],
    deletions: deletions.ok ? deletions.events : [],
    known,
    deletable,
  })

  // Resolution assertions (PEEK-128). Fetched by channel like messages — unlike
  // kind:7 these DO carry `h` — but imported after them, because an assertion
  // whose target arrived in this same run has nothing to attach to until the
  // messages are in.
  //
  // Deliberately not filtered by `since`: the cursor advances with the channel,
  // and an assertion about an old message can be made at any time, so a
  // cursored read would silently miss resolutions of anything older than the
  // window.
  const assertions = await queryRelay(
    relayUrl,
    [{ kinds: [KIND.ASSERTION], '#h': [plan.channelUuid], limit: PAGE_LIMIT }],
    token.accessToken,
    token.pubkey,
  )
  if (assertions.ok && assertions.events.length > 0) {
    await api.importResolutions({ topicKey, assertions: assertions.events })
  }
}

/**
 * Fill in names and faces for anyone still showing a placeholder (PEEK-72).
 *
 * Asks who is *missing* a profile rather than reacting to new activity — the
 * distinction the ticket turned on. Anyone whose messages predate the sync
 * cursor is never revisited by the channel path, so waiting for them to speak
 * fixes only whoever spoke most recently.
 *
 * `kind:0` is not channel-scoped, so membership is not in play here; only auth.
 */
export async function syncStaleProfilesFromRelay(
  relayUrl: string,
  token: StoredToken,
  api: {
    pubkeysMissingProfile: () => Promise<string[]>
    recordProfiles: (args: { profiles: unknown[] }) => Promise<{ ok: boolean; reason?: string }>
  },
): Promise<void> {
  const pubkeys = await api.pubkeysMissingProfile()
  if (pubkeys.length === 0) return

  const profiles = await queryRelay(
    relayUrl,
    [{ kinds: [0], authors: pubkeys, limit: pubkeys.length }],
    token.accessToken,
    token.pubkey,
  )
  if (!profiles.ok || profiles.events.length === 0) return

  const result = await api.recordProfiles({ profiles: profiles.events })
  if (!result.ok) console.warn('[nostr] recordProfiles failed:', result.reason)
}
