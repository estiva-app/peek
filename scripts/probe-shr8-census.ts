/**
 * How much of Peek's non-DM content exists only in Convex — SHR-8's census.
 *
 *   ESTIVA_ID_CLIENT_ID=… ESTIVA_ID_CLIENT_SECRET=… \
 *     npx tsx --tsconfig tsconfig.app.json scripts/probe-shr8-census.ts
 *
 * Read-only. Convex's public queries plus the relay's `/query`; it publishes
 * nothing and deletes nothing.
 *
 * This generalises `scripts/probe-fol25-convex-vs-relay.ts`, which measured the
 * 41-of-175 the ticket quotes. That probe is on `origin/fol-25-thread-rendering`
 * and never reached `main` — the two probe commits were pushed to the branch
 * after peek#226 merged. It is superseded here rather than revived, because it
 * under-counts in three ways that all point the same direction:
 *
 *   1. **It reads nine hardcoded titles.** A census has to be every topic, and
 *      every huddle: `parentKind` is `topic | dm | huddle`, and only `dm` is out
 *      of scope for this project.
 *   2. **It never checks a reply.** It counts `replyCount` on an *unpublished
 *      root* and attributes those replies to the gap. A reply carries its own
 *      `nostrEventId` (`schema.ts` `replies`), so a reply under a *published*
 *      root can be missing independently and nothing has ever looked.
 *   3. **It trusts the column.** `nostrEventId` records what the publish action
 *      was told on acceptance; it is not evidence the event is readable today.
 *      Fourteen Peek topic channels were soft-deleted on the relay (PEE-30), and
 *      a `9008` hides everything under the `h` — so a row can carry a perfectly
 *      good id and still have no reachable event. This asks the relay.
 *
 * That third leg is the one that decides the ticket's done-when, which is "0
 * messages and 0 attachments with no relay event" — not "0 with a null column".
 *
 * DMs are counted only if a viewer is available, and normally are not: Convex's
 * DM queries resolve through `viewerId(ctx)`, which is null for an
 * unauthenticated caller. Their size is a question for the DM track, and this
 * prints what it can rather than implying zero.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const CONVEX = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'
const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

/** Ids per `/query` filter, and filters per POST — the relay takes 128 filters
 *  per request and clamps `limit` per filter (buzz's batching contract). */
const IDS_PER_FILTER = 100
const FILTERS_PER_POST = 20

interface Token {
  accessToken: string
  pubkey: string
}

async function token(): Promise<Token> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // camelCase — a snake_case body comes back "401 No session cookie", which
    // reads as a credential problem (scripts/probe-shr9-open-work.ts).
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

/** `/query` with a bare JSON array of filters, NIP-98 signed per request. */
async function query(filters: Record<string, unknown>[], t: Token): Promise<{ status: number; events: SignedEvent[]; text: string }> {
  const url = `${RELAY_URL.replace(/\/+$/, '')}/query`
  const body = JSON.stringify(filters)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  const text = await res.text()
  if (res.status !== 200) return { status: res.status, events: [], text }
  try {
    return { status: res.status, events: JSON.parse(text) as SignedEvent[], text }
  } catch {
    return { status: res.status, events: [], text }
  }
}

async function convex<T>(path: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CONVEX}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const body = (await res.json()) as { status?: string; value?: unknown; errorMessage?: string }
  if (body.status === 'error') throw new Error(`${path}: ${body.errorMessage}`)
  return (body.value ?? body) as T
}

type Row = {
  id: string
  createdAt: number
  authorName?: string
  body?: string
  files?: unknown[]
  replyCount?: number
  nostrEventId?: string | null
}

/** One message or reply, flattened — the unit the ticket counts. */
interface Item {
  surface: string
  kind: 'root' | 'reply'
  id: string
  createdAt: number
  author: string
  body: string
  eventId: string | null
  attachments: number
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** Which of these event ids the relay will actually return. */
async function reachableOnRelay(
  ids: string[],
  t: Token,
): Promise<{ found: Map<string, SignedEvent>; refusals: string[] }> {
  const found = new Map<string, SignedEvent>()
  const refusals: string[] = []
  const filters = chunk(ids, IDS_PER_FILTER).map((batch) => ({ ids: batch, limit: batch.length }))
  for (const post of chunk(filters, FILTERS_PER_POST)) {
    const res = await query(post, t)
    if (res.status !== 200) {
      refusals.push(`${res.status} ${res.text.slice(0, 120)}`)
      continue
    }
    // Keep the event, not just its id: whether a published message carries its
    // attachment is a property of the event's tags, and the done-when counts
    // attachments with no relay event — so "the message is on the relay" is the
    // wrong question to stop at.
    for (const e of res.events) found.set(e.id, e)
  }
  return { found, refusals }
}

async function collectSurface(surface: string, parentKind: 'topic' | 'huddle', parentKey: string): Promise<Item[]> {
  const items: Item[] = []
  const page = await convex<{ rows: Row[] }>('messages:list', { parentKind, parentKey })
  for (const m of page.rows) {
    items.push({
      surface,
      kind: 'root',
      id: m.id,
      createdAt: m.createdAt,
      author: m.authorName ?? '?',
      body: String(m.body ?? '').replace(/\s+/g, ' ').slice(0, 60),
      eventId: m.nostrEventId ?? null,
      attachments: m.files?.length ?? 0,
    })
    // Never trust `replyCount`: a reply carries its own `nostrEventId`, so one
    // under a published root can be missing on its own.
    const replies = await convex<Row[]>('replies:list', { messageKey: m.id })
    for (const r of replies) {
      items.push({
        surface,
        kind: 'reply',
        id: r.id,
        createdAt: r.createdAt,
        author: r.authorName ?? '?',
        body: String(r.body ?? '').replace(/\s+/g, ' ').slice(0, 60),
        eventId: r.nostrEventId ?? null,
        attachments: r.files?.length ?? 0,
      })
    }
  }
  return items
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are required')
  const t = await token()

  const topics = await convex<Array<{ title: string; id: string }>>('topics:list', {})
  const huddles = await convex<Array<{ title?: string; name?: string; id: string }>>('huddles:list', {})
  console.log(`Convex: ${topics.length} topics, ${huddles.length} huddles. Relay: ${RELAY_URL}\n`)

  const items: Item[] = []
  for (const t2 of topics) items.push(...(await collectSurface(`topic/${t2.title}`, 'topic', t2.id)))
  for (const h of huddles) items.push(...(await collectSurface(`huddle/${h.title ?? h.name ?? h.id}`, 'huddle', h.id)))

  // Leg 3: ask the relay which recorded ids are actually readable.
  const recorded = [...new Set(items.filter((i) => i.eventId).map((i) => i.eventId as string))]
  const { found, refusals } = await reachableOnRelay(recorded, t)
  for (const r of refusals) console.log(`⚠  /query refused a batch: ${r}`)

  const onRelay = (i: Item) => i.eventId !== null && found.has(i.eventId)

  // Per surface.
  const bySurface = new Map<string, Item[]>()
  for (const i of items) bySurface.set(i.surface, [...(bySurface.get(i.surface) ?? []), i])

  console.log('surface                                        msgs  no-id  id-but-gone  attach  gap')
  for (const [surface, rows] of [...bySurface].sort()) {
    const noId = rows.filter((i) => i.eventId === null)
    const gone = rows.filter((i) => i.eventId !== null && !found.has(i.eventId))
    const attach = rows.reduce((n, i) => n + i.attachments, 0)
    const gap = noId.length + gone.length
    if (gap === 0 && attach === 0) continue
    console.log(
      `${surface.slice(0, 44).padEnd(44)} ${String(rows.length).padStart(5)} ${String(noId.length).padStart(6)} ` +
        `${String(gone.length).padStart(12)} ${String(attach).padStart(7)} ${String(gap).padStart(4)}`,
    )
  }

  const noId = items.filter((i) => i.eventId === null)
  const gone = items.filter((i) => i.eventId !== null && !found.has(i.eventId))
  const attachTotal = items.reduce((n, i) => n + i.attachments, 0)
  // An attachment is on the relay only if its message's event actually carries
  // an `imeta` describing it. Counting attachments on published messages would
  // report the mirror as working when no imeta was ever written.
  const attachDescribed = items.reduce((n, i) => {
    if (i.attachments === 0 || !i.eventId) return n
    const e = found.get(i.eventId)
    if (!e) return n
    return n + Math.min(i.attachments, e.tags.filter((tag) => tag[0] === 'imeta').length)
  }, 0)
  const attachOnRelay = items.filter(onRelay).reduce((n, i) => n + i.attachments, 0)

  console.log(`\n— totals ———————————————————————————————`)
  console.log(`messages in Convex (non-DM):        ${items.length}  (${items.filter((i) => i.kind === 'root').length} roots, ${items.filter((i) => i.kind === 'reply').length} replies)`)
  console.log(`  never published (null id):        ${noId.length}  (${noId.filter((i) => i.kind === 'root').length} roots, ${noId.filter((i) => i.kind === 'reply').length} replies)`)
  console.log(`  id recorded, relay has no event:  ${gone.length}  (${gone.filter((i) => i.kind === 'root').length} roots, ${gone.filter((i) => i.kind === 'reply').length} replies)`)
  console.log(`  → with no relay event at all:     ${noId.length + gone.length}`)
  console.log(`attachments in Convex:              ${attachTotal}`)
  console.log(`  on a message that is on the relay: ${attachOnRelay}`)
  console.log(`  described by an imeta on that event: ${attachDescribed}`)
  console.log(`  → with no relay event at all:     ${attachTotal - attachDescribed}`)

  // Authorship of the gap, which is the key-export list.
  const authors = new Map<string, number>()
  for (const i of [...noId, ...gone]) authors.set(i.author, (authors.get(i.author) ?? 0) + 1)
  console.log(`\nauthors of the gap (the key-export list):`)
  for (const [a, n] of [...authors].sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(4)}  ${a}`)

  console.log(`\nDMs are not counted: Convex's DM queries resolve through viewerId(), which is null here.`)
  console.log(`done-when is 0 with no relay event; currently ${noId.length + gone.length}.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
