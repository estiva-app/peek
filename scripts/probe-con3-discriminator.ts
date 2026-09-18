/**
 * CON-3: which relay events are wrongly migrated, decided by reading them.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-con3-discriminator.ts
 *
 * Read-only. Convex's public queries plus the relay's `/query`; it publishes
 * nothing, deletes nothing, and sends no retraction.
 *
 * ## The rule
 *
 * The migration ticket wants to retract FOL-25's re-posted copies and leave
 * everything else alone. Retracting the wrong set destroys correct history and
 * the wrong set is the larger one, so the rule is stated as a decision
 * procedure and every clause of it is measured below rather than assumed.
 *
 * **The marker is `orig`, and only `orig`:**
 * `['orig', <original id>, <original created_at>, <original pubkey>]`, written
 * by `fol25-topics-to-files.ts` `migrate` and `remigrate` and by nothing else
 * in the suite. Take a relay event `e`, in this order:
 *
 *   1. `e` carries `orig` → **bucket 2, a FOL-25 re-post.** Retract, once the
 *      good copy exists. `['migration', 'fol25-remigrate']` alongside it means
 *      the author-signed second run; without it, `migrate`'s agent-signed
 *      stand-in.
 *   2. Otherwise `e` is not a copy, and the Convex row it belongs to decides:
 *      no `nostrEventId` → **bucket 4, never published**; an id the relay
 *      answers nothing for → **bucket 3, recorded but unreadable**; an id the
 *      relay answers → **bucket 1, mirrored when written — leave alone.**
 *   3. An event under a topic channel that *no* Convex row points at is also
 *      bucket 1: it was written in place, carries its true date, and is waiting
 *      to be imported. One today (a Ship `kind:9` from 2026-09-17T20:52).
 *
 * ## What the ticket expected, and why each part of it is wrong
 *
 * The expected rule was "a true-time tag on a `kind:9`". Measured against
 * production 2026-09-18, all three of its parts fail, each pointing at a
 * different set:
 *
 *   1. **The copies are `kind:1111`, not `kind:9`** — NIP-22 comments on a
 *      `kind:30840` file. All 134 readable copies; no exceptions.
 *   2. **They are not in a topic channel at all.** Their `h` is the *team*
 *      Folder and their `A`/`a` is `30840:<agent>:<fileId>`. Measured: **0** of
 *      the 134 sit under a topic channel's `h`, and **0** are pointed at by a
 *      Convex row. That is the strongest form the rule can take — bucket 2 is
 *      disjoint from the topic channels by construction, not by a tag test, so
 *      an `#h` read of a Peek topic channel cannot return a copy to retract.
 *   3. **`ts` is not the marker, in both directions.** 431 events carry `ts`
 *      and no `orig` — Ship's comments — so a `ts` rule would retract 431
 *      correct events. And `remigrate`'s 134 carry **no** `ts`, so a `ts` rule
 *      would miss every copy that exists today. The overlap (`migrate`'s
 *      copies, which carried both) is 0 readable: all 549 were retracted by
 *      `remigrate`, and the agent's 569 `kind:5` name 559 targets of which 0
 *      still answer (`probe-con3-copies.ts`).
 *
 * Bucket 1's date is checked, not assumed: for all 636,
 * `|event.created_at − row.createdAt| ≤ 0.997 s`, median 0 — because
 * `convex/nostr/outbox.ts:unsignedMessage` passes `m.createdAt` straight into
 * `buildMessage` behind a 15-minute drift window. Bucket 2's is wrong as the
 * ticket says: all 134 name the true time in `orig[2]` and **none** carries it
 * as `created_at`; they are late by 1–28 days, so the 960 s commit floor is
 * still in force for these.
 *
 * ## The population, and why it is two populations
 *
 * The census (`probe-shr8-census.ts`) counts **Convex rows**. The FOL-25 copies
 * are **relay events with no Convex row** — nothing in Convex points at them. A
 * rule stated over one population cannot see the other, so this reads both and
 * joins them by event id:
 *
 *   - every Convex row, bucketed by what its `nostrEventId` resolves to;
 *   - every `kind:9`/`kind:1111` under a Peek topic channel's `h`;
 *   - every `kind:1111` under the five team Folders, which is where the copies
 *     live.
 *
 * ## Reconciling with the census
 *
 * CON-3 quotes 807 / 605 / 202 / 17. Run today this reports 837 / 653 / 184 /
 * 17, and `probe-shr8-census.ts` re-run in the same minute reports the same —
 * so the method agrees with the census exactly and the ticket's figures are an
 * older snapshot of a live database. **Bucket 3 is unchanged at 17**, the same
 * set, all in "For testing".
 *
 * One part of the drift is worth carrying into the migration ticket, which owns
 * bucket 4: it is **184**, not 202, and publication cannot be what moved it —
 * `MAX_DRIFT_MS` is 15 minutes, so a row that was null at the census can never
 * have become published since. Those 18 rows left Convex.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const CONVEX = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'
const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

/** Ids per `/query` filter, and filters per POST — buzz's batching contract. */
const IDS_PER_FILTER = 100
const FILTERS_PER_POST = 20

/** The five team Folders, FOL-20 — where `fol25-topics-to-files.ts` filed the
 *  30840s and posted the copies. Ids copied from that script's `TEAMS`. */
const TEAMS: Record<string, string> = {
  'Estiva HQ': '05bebd5b-b699-4bd4-af50-f5377df0fd67',
  Peek: 'fd03975a-eb00-49d6-a4b7-33ead1854672',
  Ship: '3167adea-877f-43c4-96fb-517a2b2d5d24',
  Leaf: '05ed05b2-0687-4be9-a096-7ab21d79fad4',
  Steer: '6f1b5cce-96ae-4817-bac2-89a1bd142576',
}

interface Token {
  accessToken: string
  pubkey: string
}

async function token(): Promise<Token> {
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

/** `/query` with a bare JSON array of filters, NIP-98 signed per request. */
async function query(filters: Record<string, unknown>[], t: Token): Promise<SignedEvent[]> {
  const url = `${RELAY_URL}/query`
  const body = JSON.stringify(filters)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  const text = await res.text()
  if (res.status !== 200) {
    console.log(`⚠  /query ${res.status}: ${text.slice(0, 160)}`)
    return []
  }
  try {
    return JSON.parse(text) as SignedEvent[]
  } catch {
    return []
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

type ConvexRow = {
  id: string
  createdAt: number
  authorName?: string
  files?: unknown[]
  nostrEventId?: string | null
}

/** One Convex message or reply — the unit the census counts. */
interface Row {
  surface: string
  channelUuid: string | null
  kind: 'root' | 'reply'
  id: string
  createdAtMs: number
  author: string
  eventId: string | null
  attachments: number
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

const tagOf = (e: SignedEvent, name: string) => e.tags.find((x) => x[0] === name)
const has = (e: SignedEvent, name: string) => e.tags.some((x) => x[0] === name)

/** `['orig', <original id>, <original created_at>, <original pubkey>]` — written
 *  by both `migrate` and `remigrate`, and by nothing else in the suite. */
const origOf = (e: SignedEvent) => tagOf(e, 'orig')?.[1]
const REMIGRATE_MARK = 'fol25-remigrate'
const remigrated = (e: SignedEvent) => e.tags.some((x) => x[0] === 'migration' && x[1] === REMIGRATE_MARK)

async function collectSurface(
  surface: string,
  parentKind: 'topic' | 'huddle',
  parentKey: string,
  channelUuid: string | null,
): Promise<Row[]> {
  const rows: Row[] = []
  const page = await convex<{ rows: ConvexRow[] }>('messages:list', { parentKind, parentKey })
  for (const m of page.rows) {
    rows.push({
      surface,
      channelUuid,
      kind: 'root',
      id: m.id,
      createdAtMs: m.createdAt,
      author: m.authorName ?? '?',
      eventId: m.nostrEventId ?? null,
      attachments: m.files?.length ?? 0,
    })
    const replies = await convex<ConvexRow[]>('replies:list', { messageKey: m.id })
    for (const r of replies) {
      rows.push({
        surface,
        channelUuid,
        kind: 'reply',
        id: r.id,
        createdAtMs: r.createdAt,
        author: r.authorName ?? '?',
        eventId: r.nostrEventId ?? null,
        attachments: r.files?.length ?? 0,
      })
    }
  }
  return rows
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are required')
  const t = await token()

  // ---- 1. Convex: the census population.
  const topics = await convex<Array<{ title: string; id: string; channelUuid: string | null }>>('topics:list', {})
  const huddles = await convex<Array<{ title?: string; name?: string; id: string }>>('huddles:list', {})
  const rows: Row[] = []
  for (const tp of topics) rows.push(...(await collectSurface(`topic/${tp.title}`, 'topic', tp.id, tp.channelUuid)))
  for (const h of huddles) rows.push(...(await collectSurface(`huddle/${h.title ?? h.name ?? h.id}`, 'huddle', h.id, null)))
  const byEventId = new Map(rows.filter((r) => r.eventId).map((r) => [r.eventId as string, r]))
  console.log(
    `Convex: ${topics.length} topics (${topics.filter((x) => x.channelUuid).length} with a channel), ` +
      `${huddles.length} huddles, ${rows.length} non-DM messages\n`,
  )

  // ---- 2. Relay: are the recorded ids readable, and what do they carry?
  const recorded = [...new Set(rows.filter((r) => r.eventId).map((r) => r.eventId as string))]
  const found = new Map<string, SignedEvent>()
  for (const post of chunk(
    chunk(recorded, IDS_PER_FILTER).map((batch) => ({ ids: batch, limit: batch.length })),
    FILTERS_PER_POST,
  )) {
    for (const e of await query(post, t)) found.set(e.id, e)
  }

  // ---- 3. Relay: everything under the topic channels, and everything under
  //         the team Folders. The first is where a mirrored message lives; the
  //         second is where FOL-25 put its copies.
  const uuids = topics.map((x) => x.channelUuid).filter((x): x is string => !!x)
  const metas = await query([{ kinds: [39000], '#d': uuids, limit: uuids.length }], t)
  const liveChannel = new Set(metas.map((e) => tagOf(e, 'd')?.[1]).filter((x): x is string => !!x))

  const inChannels: SignedEvent[] = []
  for (const post of chunk(uuids.map((u) => ({ kinds: [9, 1111], '#h': [u], limit: 2000 })), FILTERS_PER_POST)) {
    inChannels.push(...(await query(post, t)))
  }
  const onTeams: SignedEvent[] = []
  for (const [, id] of Object.entries(TEAMS)) {
    onTeams.push(...(await query([{ kinds: [9, 1111], '#h': [id], limit: 2000 }], t)))
  }
  const channelOf = new Map<string, string>()
  for (const e of [...inChannels, ...onTeams]) {
    const h = tagOf(e, 'h')?.[1]
    if (h) channelOf.set(e.id, h)
  }

  // ---- 4. The rule, applied to a Convex row.
  type Bucket = 1 | 2 | 3 | 4
  const bucketOf = (r: Row): Bucket => {
    if (!r.eventId) return 4 // never published
    const e = found.get(r.eventId)
    if (!e) return 3 // id recorded, nothing readable behind it
    return origOf(e) ? 2 : 1 // a copy would have to carry `orig`; nothing else does
  }
  const bucket = new Map<string, Bucket>(rows.map((r) => [r.id, bucketOf(r)]))
  const inBucket = (b: Bucket) => rows.filter((r) => bucket.get(r.id) === b)

  // ---- 5. Both directions of the tag test, over every event actually read.
  const all = [...new Map([...found.values(), ...inChannels, ...onTeams].map((e) => [e.id, e])).values()]
  const withOrig = all.filter((e) => origOf(e))
  const withTsOnly = all.filter((e) => has(e, 'ts') && !origOf(e))
  const withBoth = all.filter((e) => has(e, 'ts') && origOf(e))

  console.log('=== the tag test, both directions ===')
  console.log(`${all.length} distinct events read (channels + teams + recorded ids)`)
  console.log(`  carry \`orig\`:                       ${withOrig.length}  (${withOrig.filter(remigrated).length} also marked ${REMIGRATE_MARK})`)
  console.log(`  carry \`ts\` and NOT \`orig\`:          ${withTsOnly.length}  ← Ship's comments; a \`ts\` rule would retract these`)
  console.log(`  carry both:                         ${withBoth.length}  ← migrate's copies; remigrate's carry no \`ts\``)
  console.log(`  \`orig\` without \`ts\`:                ${withOrig.length - withBoth.length}  ← a \`ts\` rule would miss these`)
  const origKinds = new Map<number, number>()
  for (const e of withOrig) origKinds.set(e.kind, (origKinds.get(e.kind) ?? 0) + 1)
  console.log(`  kinds carrying \`orig\`:              ${[...origKinds].map(([k, n]) => `kind:${k} × ${n}`).join(', ') || '—'}`)
  const origInChannel = withOrig.filter((e) => uuids.includes(channelOf.get(e.id) ?? ''))
  console.log(`  \`orig\` events under a topic channel: ${origInChannel.length}  ← must be 0: bucket 2 is disjoint from the channels`)
  const origWithRow = withOrig.filter((e) => byEventId.has(e.id))
  console.log(`  \`orig\` events a Convex row points at: ${origWithRow.length}  ← must be 0: no row was ever repointed at a copy`)
  const origWithImeta = withOrig.filter((e) => has(e, 'imeta'))
  console.log(`  \`orig\` events carrying an imeta:     ${origWithImeta.length} of ${withOrig.length}  (migrate dropped media; remigrate carries it)`)

  // ---- 6. Mirrored-when-written is checkable: the event's `created_at` is the
  //         row's `createdAt`, because `unsignedMessage` passes it through.
  const b1 = inBucket(1)
  const drift = b1
    .map((r) => Math.abs((found.get(r.eventId as string) as SignedEvent).created_at * 1000 - r.createdAtMs))
    .sort((a, b) => a - b)
  const late = b1.filter((r) => Math.abs((found.get(r.eventId as string) as SignedEvent).created_at * 1000 - r.createdAtMs) > 60_000)
  console.log(`\n=== bucket 1: is the date actually true? ===`)
  console.log(`${b1.length} readable events, |event.created_at − row.createdAt|:`)
  console.log(`  max ${(drift.at(-1) ?? 0) / 1000}s, median ${(drift[Math.floor(drift.length / 2)] ?? 0) / 1000}s, over 60s: ${late.length}`)
  for (const r of late.slice(0, 10)) {
    const e = found.get(r.eventId as string) as SignedEvent
    console.log(`  ${r.surface} ${r.id.slice(0, 10)} row ${new Date(r.createdAtMs).toISOString().slice(0, 16)} vs event ${new Date(e.created_at * 1000).toISOString().slice(0, 16)}`)
  }

  // ---- 7. Bucket 3: a recorded id nothing answers for.
  const b3 = inBucket(3)
  const b3BySurface = new Map<string, number>()
  for (const r of b3) b3BySurface.set(r.surface, (b3BySurface.get(r.surface) ?? 0) + 1)
  console.log(`\n=== bucket 3: id recorded, nothing readable ===`)
  for (const [s, n] of [...b3BySurface].sort((a, b) => b[1] - a[1])) {
    const uuid = rows.find((r) => r.surface === s)?.channelUuid
    console.log(`  ${String(n).padStart(3)}  ${s}  channel ${uuid ? `${uuid.slice(0, 8)} ${liveChannel.has(uuid) ? 'live' : 'NOT in a 39000 read — soft-deleted (PEE-30)'}` : 'none'}`)
  }

  // ---- 8. Bucket 4, and the relay events with no Convex row at all.
  const b4 = inBucket(4)
  const b4BySurface = new Map<string, number>()
  for (const r of b4) b4BySurface.set(r.surface, (b4BySurface.get(r.surface) ?? 0) + 1)
  console.log(`\n=== bucket 4: never published ===`)
  for (const [s, n] of [...b4BySurface].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(3)}  ${s}`)

  const orphan = inChannels.filter((e) => !byEventId.has(e.id))
  console.log(`\n=== relay events in a topic channel with no Convex row ===`)
  console.log(`${inChannels.length} events under the ${uuids.length} topic channels, ${orphan.length} unmatched`)
  const orphanKinds = new Map<string, number>()
  for (const e of orphan) {
    const label = `kind:${e.kind}${has(e, 'ts') ? ' +ts' : ''}${origOf(e) ? ' +orig' : ''}`
    orphanKinds.set(label, (orphanKinds.get(label) ?? 0) + 1)
  }
  for (const [k, n] of [...orphanKinds].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`)
  // Named individually: the done-when is "exactly one of four buckets", and an
  // event in a topic channel that no Convex row points at is the one shape none
  // of the four describes — so it has to be looked at, not counted.
  const titleOf = new Map(topics.filter((x) => x.channelUuid).map((x) => [x.channelUuid as string, x.title]))
  for (const e of orphan.slice(0, 10)) {
    console.log(
      `    ${e.id.slice(0, 10)} kind:${e.kind} by ${e.pubkey.slice(0, 8)} ${new Date(e.created_at * 1000).toISOString().slice(0, 16)} ` +
        `in "${titleOf.get(channelOf.get(e.id) ?? '') ?? '?'}"  ${JSON.stringify(e.content).slice(0, 70)}`,
    )
    console.log(`      tags: ${e.tags.map((x) => x[0]).join(' ')}`)
  }

  // ---- 9. Are the copies actually mis-dated? Bucket 2 is defined as "today's
  //         date", and that is the property `remigrate` tried and failed to
  //         avoid — so it is measured, not assumed. `orig[2]` is the original's
  //         `created_at`, which is the true time.
  console.log(`\n=== bucket 2: how wrong is the date, and who signed it? ===`)
  const dated = withOrig.map((e) => ({ e, trueAt: Number(tagOf(e, 'orig')?.[2] ?? 0) })).filter((x) => x.trueAt > 0)
  const backdated = dated.filter((x) => Math.abs(x.e.created_at - x.trueAt) <= 1)
  const agentSigned = withOrig.filter((e) => e.pubkey === t.pubkey)
  console.log(`  ${dated.length} copies name a true time in \`orig\`; ${backdated.length} carry it as \`created_at\``)
  if (dated.length > backdated.length) {
    const off = dated.filter((x) => Math.abs(x.e.created_at - x.trueAt) > 1).map((x) => x.e.created_at - x.trueAt)
    off.sort((a, b) => a - b)
    console.log(`  the rest are late by ${(off[0]! / 86400).toFixed(0)}–${(off.at(-1)! / 86400).toFixed(0)} days (the 960 s commit floor, remigrate's doc)`)
  }
  console.log(`  signed by the agent: ${agentSigned.length}; by the original author: ${withOrig.length - agentSigned.length}`)

  // ---- 10. Why the totals moved since the census.
  //
  // The ticket quotes 807 / 605 / 202 / 17; today the census script itself
  // reports 837 / 653 / 184 / 17. Only two mechanisms can move these numbers,
  // and they bound the answer between them:
  //
  //   - a new message — `unsignedMessage` refuses anything outside a 15-minute
  //     drift window (`convex/nostr/refs.ts` `MAX_DRIFT_MS`), so a row that was
  //     null at the census can never become published later. The null count can
  //     only fall by a row leaving;
  //   - an **import** — `importChannel` creates Convex rows from relay events
  //     and stamps the event's `created_at`, so a row can appear today already
  //     published and dated weeks ago. That is what a `createdAt` cut cannot see.
  console.log(`\n=== when the rows were written ===`)
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const recent = rows.filter((r) => r.createdAtMs > Date.now() - 5 * 86400_000)
  const byDay = new Map<string, { n: number; pub: number }>()
  for (const r of recent) {
    const d = byDay.get(day(r.createdAtMs)) ?? { n: 0, pub: 0 }
    d.n++
    if (r.eventId) d.pub++
    byDay.set(day(r.createdAtMs), d)
  }
  for (const [d, v] of [...byDay].sort()) console.log(`  ${d}  ${String(v.n).padStart(3)} rows, ${v.pub} published`)
  console.log(`  everything older: ${rows.length - recent.length} rows, ${rows.filter((r) => r.createdAtMs <= Date.now() - 5 * 86400_000 && r.eventId).length} published`)

  // ---- 11. Reconciliation with the census.
  const b2 = inBucket(2)
  console.log(`\n— reconciliation ————————————————————————`)
  console.log(`Convex rows (non-DM):                 ${rows.length}   census 807`)
  console.log(`  bucket 1  mirrored when written:    ${b1.length}`)
  console.log(`  bucket 2  a FOL-25 copy:            ${b2.length}`)
  console.log(`  bucket 3  id recorded, gone:        ${b3.length}   census 17`)
  console.log(`  bucket 4  never published:          ${b4.length}   census 202`)
  console.log(`  1+2+3 = rows with a recorded id:    ${b1.length + b2.length + b3.length}   census 605`)
  console.log(`  sum:                                ${b1.length + b2.length + b3.length + b4.length}`)
  console.log(`\nFOL-25 copies on the relay (no Convex row):  ${withOrig.length}`)
  console.log(`  by migrate (agent-signed, \`ts\`, no marker): ${withOrig.filter((e) => !remigrated(e)).length}`)
  console.log(`  by remigrate (author-signed, marked):       ${withOrig.filter(remigrated).length}`)
  console.log(`\nNo retraction is sent from this probe.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
