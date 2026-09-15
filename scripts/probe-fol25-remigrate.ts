/**
 * What `remigrate` needs to know before it is allowed to write — FOL-25.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-fol25-remigrate.ts
 *
 * Read-only. Four questions, each of which decides a line of the re-migration
 * and none of which can be answered by reading code:
 *
 *  1. **Are the originals still readable?** The nine files that still hold a
 *     re-posted conversation are the nine whose channel the `delete` run
 *     removed, and a `9008` hides everything under the `h`. If the `kind:9`s
 *     are gone, there is nothing to re-sign and the ticket has no plan.
 *  2. **Does buzz index an uppercase `#A`?** A NIP-22 reply drops its
 *     lowercase `a` (`foreign.ts` §replyToCommentAsViewer), so `#a` — what
 *     `migrate` counts with — would undercount the threaded copies and the
 *     done-when would pass while half the run had gone missing.
 *  3. **Has a back-dated `created_at` ever been accepted?** `MAX_TIMESTAMP_
 *     DRIFT_SECS` defaults to 900 and whether production widened it lives in
 *     `/opt/buzz/.env`, which is not readable from here. An event on the relay
 *     older than 900 s before the relay's own first write settles it.
 *  4. **What is on the files now?** The copies `remigrate` must delete, and
 *     the baseline the done-when is measured against.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const CONVEX_URL = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'

const TEAMS: Record<string, string> = {
  'Estiva HQ': '05bebd5b-b699-4bd4-af50-f5377df0fd67',
  Peek: 'fd03975a-eb00-49d6-a4b7-33ead1854672',
  Ship: '3167adea-877f-43c4-96fb-517a2b2d5d24',
  Leaf: '05ed05b2-0687-4be9-a096-7ab21d79fad4',
  Steer: '6f1b5cce-96ae-4817-bac2-89a1bd142576',
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

function queryAs(t: { accessToken: string; pubkey: string }) {
  return async (filters: Record<string, unknown>[]): Promise<SignedEvent[]> => {
    const url = `${RELAY_URL}/query`
    const body = JSON.stringify(filters)
    const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
      body,
    })
    const text = await res.text()
    if (res.status !== 200) throw new Error(`POST /query: ${res.status} ${text}`)
    return JSON.parse(text) as SignedEvent[]
  }
}

const tag = (e: SignedEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1]
const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ')

async function convexTopics(): Promise<Array<{ title: string; uuid: string }>> {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'topics:list', args: {}, format: 'json' }),
  })
  if (!res.ok) throw new Error(`convex topics:list: ${res.status}`)
  const body = (await res.json()) as { value?: Array<{ title: string; channelUuid: string | null }> }
  const rows = body.value ?? (body as unknown as Array<{ title: string; channelUuid: string | null }>)
  return rows.filter((r) => r.channelUuid).map((r) => ({ title: r.title, uuid: r.channelUuid! }))
}

async function main() {
  const t = await token()
  const query = queryAs(t)
  console.log(`identity ${t.pubkey.slice(0, 8)}…  relay ${RELAY_URL}\n`)

  // ---- 4 + 1. Every file this identity owns in the five teams, and what hangs off it.
  const files = (await query(Object.values(TEAMS).map((h) => ({ kinds: [30840], '#h': [h], authors: [t.pubkey], limit: 200 }))))
    .filter((e) => !!tag(e, 'd'))
    .sort((a, b) => (tag(a, 'title') ?? '').localeCompare(tag(b, 'title') ?? ''))
  const teamName = (h: string) => Object.entries(TEAMS).find(([, v]) => v === h)?.[0] ?? h.slice(0, 8)
  const byTitle = new Map((await convexTopics()).map((r) => [r.title, r.uuid]))

  console.log(`=== ${files.length} file(s) owned by this identity in the five teams ===`)
  let aWorks = 0
  let bigA = 0
  for (const f of files) {
    const title = tag(f, 'title') ?? '(untitled)'
    const address = `30840:${f.pubkey}:${tag(f, 'd')}`
    // The same conversation asked three ways: lowercase `a` (what `migrate`
    // wrote and counts), uppercase `A` (what a NIP-22 reply keeps), and the
    // originals still under the old channel's `h`.
    const [viaLower, viaUpper] = await Promise.all([
      query([{ kinds: [1111], '#a': [address], limit: 2000 }]),
      query([{ kinds: [1111], '#A': [address], limit: 2000 }]),
    ])
    aWorks += viaLower.length
    bigA += viaUpper.length
    const uuid = byTitle.get(title)
    const originals = uuid ? await query([{ kinds: [9, 1111], '#h': [uuid], limit: 2000 }]) : []
    const withOrig = viaLower.filter((e) => e.tags.some((x) => x[0] === 'orig')).length
    console.log(
      `${title}  [${teamName(tag(f, 'h') ?? '')}]\n` +
        `    file ${tag(f, 'd')}  #a=${viaLower.length} (orig-tagged ${withOrig})  #A=${viaUpper.length}` +
        `  channel ${uuid ? `${uuid.slice(0, 8)} holds ${originals.length}` : 'no convex row'}`,
    )
  }
  console.log(`\n#a total ${aWorks}, #A total ${bigA} — uppercase indexing ${bigA === 0 && aWorks > 0 ? 'LOOKS UNSUPPORTED' : 'works'}\n`)

  // ---- 3. Has the relay ever taken a back-dated created_at?
  const first = await query([{ kinds: [9], limit: 1 }])
  const old = await query([{ kinds: [9, 1111, 30840], until: 1753999200, limit: 20 }]) // 2025-08-01
  console.log(`=== back-dating ===`)
  console.log(`oldest sample: ${old.length} event(s) before 2025-08-01`)
  for (const e of old.slice(0, 5)) console.log(`    ${e.kind} ${e.id.slice(0, 8)} ${day(e.created_at)} by ${e.pubkey.slice(0, 8)}`)
  if (first[0]) console.log(`    (one recent kind:9 for scale: ${day(first[0].created_at)})`)

  // ---- 5. Can the originals be reached by id, now that their channel is deleted?
  //
  // A `9008` hides a channel's events from an `#h` read, which is how the
  // nine migrated topics came to answer 0. Whether it also hides them from an
  // `ids:` read is the whole ticket: every copy carries `['orig', <id>,
  // <created_at>, <pubkey>]`, so if an id lookup answers, the originals —
  // tags, `e` markers, `imeta` and all — are recoverable without the box.
  const copies = (
    await query(files.map((f) => ({ kinds: [1111], '#a': [`30840:${f.pubkey}:${tag(f, 'd')}`], limit: 2000 })))
  ).filter((e) => e.tags.some((x) => x[0] === 'orig'))
  const origIds = [...new Set(copies.map((e) => e.tags.find((x) => x[0] === 'orig')![1]!))]
  console.log(`\n=== originals by id ===`)
  console.log(`${copies.length} orig-tagged copies naming ${origIds.length} distinct original(s)`)
  const found: SignedEvent[] = []
  for (let i = 0; i < origIds.length; i += 50) {
    found.push(...(await query([{ ids: origIds.slice(i, i + 50), limit: 100 }])))
  }
  console.log(`ids: read answers ${found.length} of ${origIds.length}`)
  for (const e of found.slice(0, 4)) {
    const shown = e.tags.filter((x) => ['e', 'h', 'imeta', 'p', 'q'].includes(x[0]))
    console.log(`    ${e.kind} ${e.id.slice(0, 8)} ${day(e.created_at)} by ${e.pubkey.slice(0, 8)}  tags ${JSON.stringify(shown).slice(0, 220)}`)
  }
  if (found.length) {
    const replies = found.filter((e) => e.tags.some((x) => x[0] === 'e'))
    const media = found.filter((e) => e.tags.some((x) => x[0] === 'imeta'))
    const known = new Set(origIds)
    const resolvable = replies.filter((e) => e.tags.filter((x) => x[0] === 'e').some((x) => known.has(x[1]!)))
    console.log(`    ${replies.length} carry an e (${resolvable.length} name an original that is itself migrated), ${media.length} carry imeta`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
