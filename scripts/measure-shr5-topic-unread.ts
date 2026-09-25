/**
 * What the sidebar's topic dots cost, before and after (SHR-5, SPEC §4.3).
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   RELAY_URL=https://estiva.estiva.app npx tsx --tsconfig tsconfig.app.json scripts/measure-shr5-topic-unread.ts
 *
 * (`--tsconfig tsconfig.app.json` because the judge imports by `@/`, and only
 * that config carries the alias.) Read-only throughout: production Convex over
 * its public query endpoint, and the production relay as the agent identity.
 *
 * FOL-18's form — requests and milliseconds against production, not a fixture.
 * Read the caveats before quoting a number; there are two and they pull in
 * opposite directions.
 *
 * ## The before, and what its number is honestly measuring
 *
 * `unread.summary`'s topic half ran `containerFlags` over every topic: one
 * `messages` collect per topic, then one `replies` collect per message. **No
 * viewer-scoped Convex query can be measured from here** — `viewerId(ctx)` is
 * its first line, Convex only accepts a token whose `aud` is `estiva-peek`
 * (`convex/auth.config.ts`), and the agent identity's is not — so calling
 * `unread:summary` returns empty in one round trip and times nothing.
 *
 * `messages:list` is not viewer-gated, and for one topic it performs **the
 * same two collects in the same order** (`convex/messages.ts:389` and `:400`)
 * over the same rows. So the before is measured by running it once per topic:
 * the collects are real, the rows are production's, and the timing is a real
 * round trip. What it adds that `containerFlags` did not is `userFaces` and
 * the shaping of each row; what it lacks is the watermark comparison, which is
 * a map lookup. It is the closest honest measurement available without an
 * identity, and it is an over-estimate of the per-topic query cost by the
 * shaping and an under-estimate of one `summary` call by the fact that
 * `summary` did all of it inside a single query.
 *
 * ## The after
 *
 * `readChannelStreams` over the same topics' channels, batched
 * `MAX_FILTERS_PER_QUERY` to a POST, then `topicChannelFlags` per topic
 * against the agent's own merged read-state frontier. Both numbers are real.
 *
 * ## The coverage leg, which is the one that can make the feature wrong
 *
 * A fold only sees what was published. SHR-8 counted 202 non-DM messages on
 * production with no relay event. This prints, per topic, what Convex holds
 * against what the channel answers, and names any topic the fold would be
 * blind in — a dot that fails to light rather than content that is lost, but
 * worth knowing by name rather than in aggregate. The two counts are not
 * like-for-like: Convex is every message ever, the relay read is the newest
 * `CHANNEL_STREAM_LIMIT` inside the 90-day horizon.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { readChannelStreams, CHANNEL_STREAM_LIMIT } from '@/nostr/channelStreams'
import {
  allSlotsFilter,
  parseReadStateBlob,
  PEEK_HORIZON_DAYS,
  READ_STATE_D_PREFIX,
} from '@/nostr/readState'
import { mergeSlots, type SlotBlob } from '@/nostr/readStateMerge'
import { topicChannelFlags } from '@/api/topicUnread'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CONVEX_URL = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const FILTERS_PER_POST = 128

interface TopicRow {
  id: string
  title: string
  channelUuid?: string | null
}

let convexCalls = 0
async function convex<T>(path: string, args: Record<string, unknown> = {}): Promise<{ ms: number; value: T }> {
  const t0 = Date.now()
  convexCalls++
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const body = (await res.json()) as { status: string; value?: T; errorMessage?: string }
  if (body.status !== 'success') throw new Error(`${path}: ${body.errorMessage}`)
  return { ms: Date.now() - t0, value: body.value as T }
}

async function token(): Promise<{ accessToken: string; pubkey: string }> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grantType: 'client_credentials', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string }
  return { accessToken: body.access_token, pubkey: body.pubkey }
}

async function sign(unsigned: UnsignedEvent, accessToken: string): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (!res.ok) throw new Error(`POST /sign: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { event: SignedEvent }).event
}

let posts = 0
async function query(filters: unknown[], t: { accessToken: string; pubkey: string }): Promise<SignedEvent[]> {
  const url = `${RELAY_URL.replace(/\/+$/, '')}/query`
  const body = JSON.stringify(filters)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
  posts++
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  const text = await res.text()
  if (res.status !== 200) throw new Error(`POST /query: ${res.status} ${text}`)
  return JSON.parse(text) as SignedEvent[]
}

async function main() {
  const t = await token()
  console.log(`identity ${t.pubkey.slice(0, 8)}…  relay ${RELAY_URL}  convex ${new URL(CONVEX_URL).host}`)

  // ── The topic set, which both halves are measured over ────────────────────
  const listed = await convex<TopicRow[]>('topics:list')
  const topics = listed.value
  const channelled = topics.filter((topic): topic is TopicRow & { channelUuid: string } => !!topic.channelUuid)
  console.log(
    `\ntopics: ${topics.length} (${channelled.length} with a channel, ${topics.length - channelled.length} without), ` +
      `topics:list ${listed.ms} ms`,
  )

  // ── BEFORE ────────────────────────────────────────────────────────────────
  const floor = await convex<{ dms: string[] }>('unread:summary')
  console.log(
    `\nBEFORE\n  unread:summary unauthenticated: 1 request, ${floor.ms} ms, empty — the round-trip floor, ` +
      `not the per-row work (no identity; see the header)`,
  )
  const counts = new Map<string, { messages: number; replies: number }>()
  let beforeMs = 0
  let messages = 0
  let replies = 0
  for (const topic of topics) {
    const r = await convex<{ rows: Array<{ replyCount?: number }> }>('messages:list', {
      parentKind: 'topic',
      parentKey: topic.id,
    })
    const rows = r.value.rows ?? []
    const rc = rows.reduce((n, m) => n + (m.replyCount ?? 0), 0)
    counts.set(topic.id, { messages: rows.length, replies: rc })
    messages += rows.length
    replies += rc
    beforeMs += r.ms
  }
  // What `containerFlags` actually did per `summary` call, as a count of
  // indexed collects: the topics table, one messages collect per topic, one
  // replies collect per message, and the per-topic huddles lookup it also ran.
  const collects = 1 + topics.length + messages + topics.length
  console.log(
    `  the same collects, timed through messages:list: ${topics.length} requests, ${beforeMs} ms, ` +
      `${messages} messages and ${replies} replies`,
  )
  console.log(
    `  per summary() call that is ${collects} indexed collects (1 topics + ${topics.length} messages + ` +
      `${messages} replies + ${topics.length} huddles-by-topic), on every sidebar render`,
  )

  // ── AFTER ─────────────────────────────────────────────────────────────────
  const nowSeconds = Math.floor(Date.now() / 1000)
  const horizonSeconds = PEEK_HORIZON_DAYS * 24 * 60 * 60
  const channels = [...new Set(channelled.map((topic) => topic.channelUuid))]
  const before = posts
  const t1 = Date.now()
  const streams = await readChannelStreams(channels, nowSeconds - horizonSeconds, (f) => query(f, t))
  const afterMs = Date.now() - t1
  const events = Object.values(streams).reduce((n, list) => n + list.length, 0)
  const atLimit = Object.values(streams).filter((list) => list.length >= CHANNEL_STREAM_LIMIT).length
  console.log(
    `\nAFTER\n  readChannelStreams over ${channels.length} channels: ${posts - before} POST(s) ` +
      `(${Math.ceil(channels.length / FILTERS_PER_POST)} expected), ${afterMs} ms, ${events} events, ` +
      `${atLimit} channel(s) at the ${CHANNEL_STREAM_LIMIT} limit`,
  )
  console.log(
    `  plus the unread:summary call the huddle and DM halves still make — which is the same one request ` +
      `the before already spent, now carrying topicMarks as well`,
  )

  // ── The judge, as this identity ───────────────────────────────────────────
  const slotEvents = await query([allSlotsFilter(t.pubkey, Date.now(), PEEK_HORIZON_DAYS)], t)
  const slots: SlotBlob[] = []
  for (const e of slotEvents) {
    const dTag = e.tags.find((x) => x[0] === 'd')?.[1]
    if (!dTag?.startsWith(READ_STATE_D_PREFIX)) continue
    const res = await fetch(`${ID_ORIGIN}/nip44/decrypt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${t.accessToken}` },
      body: JSON.stringify({ ciphertext: e.content }),
    })
    if (!res.ok) continue
    const { plaintext } = (await res.json()) as { plaintext: string }
    const blob = parseReadStateBlob(plaintext)
    if (blob) slots.push({ dTag, eventId: e.id, createdAt: e.created_at, blob })
  }
  const merged = mergeSlots(slots)
  console.log(
    `\nfrontier: ${slotEvents.length} kind:30078 event(s), ${slots.length} slot(s) decrypted, ` +
      `${Object.keys(merged).length} context(s)`,
  )
  const judgeStart = Date.now()
  let lit = 0
  let urgent = 0
  for (const topic of channelled) {
    const flags = topicChannelFlags(topic.channelUuid, streams[topic.channelUuid] ?? [], {
      marker: (context) => (context ? merged[context] : undefined),
      me: t.pubkey,
      nowSeconds,
      horizonSeconds,
    })
    if (flags.unread) lit++
    if (flags.urgent) urgent++
  }
  console.log(
    `  judged ${channelled.length} topics in ${Date.now() - judgeStart} ms: ${lit} dot, ${urgent} urgent, ` +
      `as ${t.pubkey.slice(0, 8)}… (an identity that has read nothing, so this is the all-new case)`,
  )

  // ── Coverage: what the fold cannot see ────────────────────────────────────
  console.log(`\nCOVERAGE (Convex rows vs the channel's answer; SHR-8 counted 202 unmigrated non-DM messages)`)
  let blind = 0
  let convexTotal = 0
  let relayTotal = 0
  for (const topic of channelled) {
    const c = counts.get(topic.id) ?? { messages: 0, replies: 0 }
    const convexRows = c.messages + c.replies
    const relayRows = (streams[topic.channelUuid] ?? []).length
    convexTotal += convexRows
    relayTotal += relayRows
    if (convexRows > 0 && relayRows === 0) {
      blind++
      console.log(`  BLIND  ${topic.title.slice(0, 50).padEnd(50)} ${convexRows} in Convex, 0 on the relay`)
    } else if (relayRows < convexRows) {
      console.log(`  partial ${topic.title.slice(0, 49).padEnd(49)} ${convexRows} in Convex, ${relayRows} on the relay`)
    }
  }
  console.log(
    `  ${convexTotal} messages+replies in Convex, ${relayTotal} events in the channels, ` +
      `${blind} topic(s) the fold is blind in`,
  )
  console.log(`\ntotal: ${convexCalls} Convex requests, ${posts} POST /query this run`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
