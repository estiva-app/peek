/**
 * FOL-22: put the 25 topics into the five team Folders, then delete every
 * other Folder — run as the agent identity against production.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol22-place-and-delete.ts plan
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol22-place-and-delete.ts place
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol22-place-and-delete.ts delete
 *
 * `plan` reads and prints; the other two write, and both re-read what they
 * changed and say what the relay now answers, never what was sent.
 *
 * **Placing** is one `kind:1852 add` per team. A team Folder with no
 * `kind:30890` is read by containment + placement; the first command gives it
 * state, and from then on it lists only what the state names — so the first
 * `add` carries the projects FOL-20 placed there as well as the topics.
 *
 * **Deleting** is `kind:9008` on every Folder that is neither a team nor one
 * of the 25 topics. Soft-delete: everything under that `h` stops resolving.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor, buildDeleteChannel, toNostrSeconds } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import {
  createPeopleCache,
  createProjectionCache,
  listFolders,
  resolveFolderContents,
  type FolderSummary,
  type QueryFn,
} from '@estiva-app/interop'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
/** The deployed backend — `[Development]` by Convex's label, live by peek.estiva.app (CLAUDE.md). */
const CONVEX_URL = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'
/** Between writes: the relay's write quota trips after a handful in a row. */
const WRITE_GAP_MS = 6_000

/** The five, by id — FOL-20, 2026-09-14. */
const TEAMS: Record<string, string> = {
  'Estiva HQ': '05bebd5b-b699-4bd4-af50-f5377df0fd67',
  Peek: 'fd03975a-eb00-49d6-a4b7-33ead1854672',
  Ship: '3167adea-877f-43c4-96fb-517a2b2d5d24',
  Leaf: '05ed05b2-0687-4be9-a096-7ab21d79fad4',
  Steer: '6f1b5cce-96ae-4817-bac2-89a1bd142576',
}

/** Miky's sort, from the issue (2026-09-14). Topic channel name → team. */
const SORT: Array<[string, keyof typeof TEAMS]> = [
  ['AI Tips', 'Estiva HQ'],
  ['Alternatives to Estiva / Peek', 'Estiva HQ'],
  ['Claude on Estiva / Estiva Steer', 'Steer'],
  ['Conversation across apps', 'Peek'],
  ['Estiva Suits Updates', 'Estiva HQ'],
  ['Feedback on Peek', 'Peek'],
  ['Feedback on Ship', 'Ship'],
  ['Folders: Universal navigation concept', 'Estiva HQ'],
  ['For testing', 'Peek'],
  ['Intelligence in Peek', 'Peek'],
  ['Interesting Claude-generated docs - Renamed 4', 'Steer'],
  ['Local & AI development', 'Estiva HQ'],
  ['Pitch for Nostr for Business', 'Estiva HQ'],
  ['Planning and sequencing', 'Estiva HQ'],
  ['Project: Catch up the Buzz fork', 'Peek'],
  ['Project: Cross-app read state', 'Peek'],
  ['Project: DMs on Nostr (DM channels)', 'Peek'],
  ["Project: Peek's Intelligence", 'Peek'],
  ['Project: Rewrite Ship with shared foundation', 'Ship'],
  ['Project: Shared foundation packages', 'Estiva HQ'],
  ['Scenarios to demonstrate Nostr for Business', 'Estiva HQ'],
  ['Widgets', 'Estiva HQ'],
  ['Domain name - brainstorming', 'Estiva HQ'],
  ['Peek vision - initial notes', 'Peek'],
  ['Researching using Buzz "backend" to power Peek', 'Peek'],
]

type Token = { accessToken: string; pubkey: string }

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

async function sign(unsigned: UnsignedEvent, t: Token): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t.accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (!res.ok) throw new Error(`POST /sign: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { event: SignedEvent }).event
}

async function bridge(path: '/query' | '/events', payload: unknown, t: Token): Promise<{ status: number; text: string }> {
  const url = `${RELAY_URL}${path}`
  const body = JSON.stringify(payload)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  return { status: res.status, text: await res.text() }
}

function queryFn(t: Token): QueryFn {
  return async (filters) => {
    const { status, text } = await bridge('/query', filters, t)
    if (status !== 200) throw new Error(`POST /query: ${status} ${text}`)
    return JSON.parse(text) as SignedEvent[]
  }
}

/** Publish one signed event; the relay refuses as 200 with `accepted: false`. */
async function publish(unsigned: UnsignedEvent, t: Token): Promise<{ ok: boolean; reason?: string; id: string }> {
  const signed = await sign(unsigned, t)
  const { status, text } = await bridge('/events', signed, t)
  let parsed: { accepted?: boolean; reason?: string; message?: string } = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  const ok = status === 200 && parsed.accepted !== false
  return { ok, reason: ok ? undefined : (parsed.reason ?? parsed.message ?? `${status} ${text.slice(0, 120)}`), id: signed.id }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Plan = {
  folders: FolderSummary[]
  /** topic name → channel uuid */
  topics: Map<string, string>
  /** channel uuid → `39000:<pubkey>:<uuid>` */
  topicAddress: Map<string, string>
  /** team id → the addresses its Folder currently lists (projects by placement) */
  teamContents: Map<string, { hasState: boolean; addresses: string[] }>
}

/**
 * The sort names topics by their Convex title, and one of them was renamed in
 * Convex only ("Alternatives to Estiva / Peek" is the relay's "Buzz - new
 * Slack on Nostr by Block"), so the title → channel map comes from Convex,
 * which is what the ticket's list was read from. `topics:list` is public.
 */
async function convexTopics(): Promise<Map<string, string>> {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'topics:list', args: {}, format: 'json' }),
  })
  if (!res.ok) throw new Error(`convex topics:list: ${res.status}`)
  const body = (await res.json()) as { value?: Array<{ title: string; channelUuid: string | null }> }
  const rows = body.value ?? (body as unknown as Array<{ title: string; channelUuid: string | null }>)
  const out = new Map<string, string>()
  for (const r of rows) if (r.channelUuid) out.set(r.title, r.channelUuid)
  return out
}

async function plan(query: QueryFn): Promise<Plan> {
  const folders = await listFolders(query)
  const onRelay = new Set(folders.map((f) => f.id))
  const byTitle = await convexTopics()

  const topics = new Map<string, string>()
  for (const [name] of SORT) {
    const uuid = byTitle.get(name)
    if (!uuid) throw new Error(`"${name}": no Convex topic with a channel carries that title`)
    if (!onRelay.has(uuid)) throw new Error(`"${name}": channel ${uuid} is not in listFolders`)
    topics.set(name, uuid)
  }

  // The channel's own address needs the pubkey that signed its kind:39000.
  const metas = await query([{ kinds: [39000], '#d': [...topics.values()], limit: 100 }])
  const topicAddress = new Map<string, string>()
  for (const uuid of topics.values()) {
    const meta = metas.find((e) => e.tags.some((tag) => tag[0] === 'd' && tag[1] === uuid))
    if (!meta) throw new Error(`no kind:39000 for ${uuid}`)
    topicAddress.set(uuid, `39000:${meta.pubkey}:${uuid}`)
  }

  const people = createPeopleCache().viaRelay(query)
  const cache = createProjectionCache()
  const teamContents = new Map<string, { hasState: boolean; addresses: string[] }>()
  for (const id of Object.values(TEAMS)) {
    const contents = await resolveFolderContents(id, query, people, cache)
    teamContents.set(id, {
      hasState: contents.hasState,
      addresses: contents.files.flatMap((f) => (f.address ? [f.address] : [])),
    })
  }
  return { folders, topics, topicAddress, teamContents }
}

function printPlan(p: Plan) {
  console.log(`${p.folders.length} Folder(s) on the relay`)
  for (const [team, id] of Object.entries(TEAMS)) {
    const current = p.teamContents.get(id)!
    console.log(`\n${team} ${id} — ${current.hasState ? 'state' : 'bare'}, lists ${current.addresses.length}:`)
    for (const a of current.addresses) console.log(`    keep  ${a}`)
    for (const [name, t] of SORT) if (t === team) console.log(`    add   ${p.topicAddress.get(p.topics.get(name)!)}  ${name}`)
  }
  const keep = new Set([...Object.values(TEAMS), ...p.topics.values()])
  const doomed = p.folders.filter((f) => !keep.has(f.id))
  console.log(`\n${doomed.length} Folder(s) to delete:`)
  for (const f of doomed) console.log(`    ${f.id}  ${f.hasState ? 'state' : 'bare '}  ${JSON.stringify(f.name ?? '')}`)
}

async function place(p: Plan, query: QueryFn, t: Token) {
  const people = createPeopleCache().viaRelay(query)
  for (const [team, id] of Object.entries(TEAMS)) {
    const current = p.teamContents.get(id)!
    const topicAddresses = SORT.filter(([, tm]) => tm === team).map(([name]) => p.topicAddress.get(p.topics.get(name)!)!)
    if (topicAddresses.length === 0) {
      console.log(`${team}: nothing sorted into it, left as it is`)
      continue
    }
    // Bare: the first state must carry what placement listed. With state: an
    // add is additive, so only the topics go.
    const addresses = current.hasState ? topicAddresses : [...current.addresses, ...topicAddresses]
    const unsigned: UnsignedEvent = {
      pubkey: t.pubkey,
      created_at: toNostrSeconds(Date.now()),
      kind: 1852,
      tags: [['h', id], ['op', 'add'], ...addresses.map((a) => ['a', a])],
      content: '',
    }
    const result = await publish(unsigned, t)
    console.log(`${team}: 1852 add ${addresses.length} → ${result.ok ? 'accepted' : `REFUSED ${result.reason}`} (${result.id.slice(0, 8)})`)
    await sleep(WRITE_GAP_MS)
    // Verify against the relay's answer, not the send.
    const after = await resolveFolderContents(id, query, people, createProjectionCache())
    const listed = new Set(after.files.map((f) => f.address))
    const expected = [...current.addresses, ...topicAddresses]
    const missing = expected.filter((a) => !listed.has(a))
    console.log(`    now ${after.hasState ? 'state' : 'bare'}, lists ${after.files.length}; missing ${missing.length}${missing.length ? ': ' + missing.join(', ') : ''}`)
  }
}

async function remove(p: Plan, query: QueryFn, t: Token) {
  const keep = new Set([...Object.values(TEAMS), ...p.topics.values()])
  const doomed = p.folders.filter((f) => !keep.has(f.id))
  const refused: string[] = []
  for (const [i, f] of doomed.entries()) {
    const result = await publish(buildDeleteChannel(t.pubkey, Date.now(), { channelUuid: f.id }), t)
    console.log(`${String(i + 1).padStart(3)}/${doomed.length} 9008 ${f.id} ${JSON.stringify(f.name ?? '')} → ${result.ok ? 'accepted' : `REFUSED ${result.reason}`}`)
    if (!result.ok) refused.push(f.id)
    await sleep(WRITE_GAP_MS)
  }
  const after = await listFolders(query)
  console.log(`\nlistFolders now: ${after.length}; refused: ${refused.length}`)
  for (const f of after) console.log(`    ${f.id}  ${f.hasState ? 'state' : 'bare '}  ${JSON.stringify(f.name ?? '')}`)
}

async function main() {
  const mode = process.argv[2]
  if (!['plan', 'place', 'delete'].includes(mode ?? '')) throw new Error('mode: plan | place | delete')
  const t = await token()
  const query = queryFn(t)
  console.log(`identity ${t.pubkey.slice(0, 8)}… relay ${RELAY_URL} mode ${mode}\n`)
  const p = await plan(query)
  if (mode === 'plan') printPlan(p)
  if (mode === 'place') await place(p, query, t)
  if (mode === 'delete') await remove(p, query, t)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
