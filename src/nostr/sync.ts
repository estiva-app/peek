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
 * **A topic and a DM run this same function** (DMS-5). Nothing below branches on
 * the container: the relay scopes both by `#h`, and Convex is the only side that
 * knows what a key names. A second copy of this for DMs is the failure mode the
 * ticket names by hand, because two self-consistent readers diverge silently.
 *
 * **Two round trips, not one, and the order is load-bearing.** Reactions are
 * addressed by target rather than by channel or cursor — kind:7 carries no `h`
 * tag — so the browser cannot know which events to ask about until the messages
 * have been imported. `importChannel` returns those targets, which is also what
 * lets a message that arrived in this same run still receive its reactions.
 *
 * Failures are logged and swallowed. A relay that is down must leave the app
 * working off its Convex rows, exactly as before.
 *
 * **Returns whether a read actually happened**, which is not the same as "did
 * not throw": most failures here are soft — a `{ ok: false }` from the relay, a
 * topic with no channel — and the function returns normally on all of them. The
 * freshness indicator (PEE-9) shows the age of the last successful sync, so
 * treating those as successes would move the timestamp on a read that fetched
 * nothing and make "synced a few seconds ago" a lie at exactly the moment the
 * age is the thing worth trusting.
 */
import type { StoredToken } from '@/auth/estivaId'
import { queryRelay } from './bridge'
import { KIND } from '@estiva-app/protocol'

/** Cap per run so one busy channel cannot dominate. Mirrors the old server-side
 *  `PAGE_LIMIT`; the relay applies it, so it has to match to page identically. */
const PAGE_LIMIT = 200

/**
 * Which container is being read — a topic or a DM (DMS-5).
 *
 * Carried as a pair through every call below rather than resolved here: the
 * relay read is identical for both (`#h` is `#h`), and Convex is the only side
 * that knows what a key names. `key` is the client-facing id — a topic's
 * seedKey-or-`_id`, and for a DM the **partner's person key**, which is how a
 * DM is addressed everywhere in the app (§2.4).
 */
export type SyncContainer = { kind: 'topic' | 'dm'; key: string }

type SyncApi = {
  syncPlan: (args: {
    containerKind: 'topic' | 'dm'
    containerKey: string
  }) => Promise<{ channelUuid: string; since: number | null } | null>
  importChannel: (args: {
    containerKind: 'topic' | 'dm'
    containerKey: string
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
    containerKind: 'topic' | 'dm'
    containerKey: string
    reactions: unknown[]
    deletions: unknown[]
    known: string[]
    deletable: string[]
  }) => Promise<{ ok: boolean; reason?: string }>
  importResolutions: (args: {
    containerKind: 'topic' | 'dm'
    containerKey: string
    assertions: unknown[]
  }) => Promise<{ ok: boolean; imported?: number; reason?: string }>
}

export async function syncContainerFromRelay(
  container: SyncContainer,
  relayUrl: string,
  token: StoredToken,
  api: SyncApi,
): Promise<boolean> {
  const where = { containerKind: container.kind, containerKey: container.key }
  const plan = await api.syncPlan(where)
  // No channel on the relay yet, or not signed in. Not a sync, and not a
  // failure worth ageing the timestamp over either — there was nothing to read.
  if (!plan) return false

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
    //
    // `40003` is an edit (CON-8). It carries an `h`, unlike a reaction or a
    // deletion, so it arrives on this same channel read rather than needing a
    // second query addressed by target — and it must, or an edit made in Ship
    // would never reach Peek and the two apps would show different text.
    kinds: [KIND.STREAM_MESSAGE, KIND.COMMENT, KIND.MESSAGE_EDIT],
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
    return false
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
    ...where,
    events: messages.events,
    profiles: profiles.ok ? profiles.events : [],
  })
  if (!imported.ok) {
    console.warn('[nostr] importChannel failed:', imported.reason)
    return false
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

  if (!reactions.ok && !deletions.ok) return false

  await api.importReactions({
    ...where,
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
    await api.importResolutions({ ...where, assertions: assertions.events })
  }
  return true
}
