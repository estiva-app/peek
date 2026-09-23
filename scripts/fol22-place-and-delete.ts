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
/** The deployed backend — `[Development]` by Convex's label, live by peek.estiva.app (`.claude/rules/convex.md`). */
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
  /*
    A `9008` hides everything carrying the Folder's `h`, and a Ship issue
    carries the `h` of the Folder it was filed in — deleting `Folders`
    (85db5b59) on 2026-09-14 took FOL-1…FOL-24 out of Ship until the box
    un-deleted it. So a Folder with state, or a project's record channel, is
    never a candidate here: those are hidden from the column, not deleted.
    And the relay lets only the channel's owner send its `9008`, so `owners`
    says whose hands the rest need.
  */
  const doomed = doomedFolders(p)
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

/** The Folders `delete` would send a `9008` at — see the note in `remove`. */
function doomedFolders(p: Plan): FolderSummary[] {
  const keep = new Set([...Object.values(TEAMS), ...p.topics.values()])
  return p.folders.filter((f) => !keep.has(f.id) && !f.hasState && !/^project-[0-9a-f]{8}$/.test(f.name ?? ''))
}

/**
 * Who can delete what. The relay's rule for `kind:9008` was owner only
 * (`side_effects.rs`: "only owner can delete group"), and the owner is the
 * member the relay lists with that role in the channel's `kind:39001`. Since
 * FOL-11 a community steward — `owner` or `admin` in the relay's roster,
 * `members` prints it — can send it too, so a Folder whose owner is a key
 * nobody holds is no longer stuck. The Folders still to delete are grouped by
 * owner, named through their profile; `delete` as a steward takes them all.
 */
async function owners(p: Plan, query: QueryFn) {
  const doomed = doomedFolders(p)
  if (doomed.length === 0) {
    console.log('nothing left to delete')
    return
  }
  const admins = await query([{ kinds: [39001], '#d': doomed.map((f) => f.id), limit: 500 }])
  const byOwner = new Map<string, FolderSummary[]>()
  for (const f of doomed) {
    const event = admins.find((e) => e.tags.some((t) => t[0] === 'd' && t[1] === f.id))
    const owner = event?.tags.find((t) => t[0] === 'p' && t[2] === 'owner')?.[1] ?? '(no 39001 — no owner listed)'
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), f])
  }
  const people = createPeopleCache().viaRelay(query)
  const named = await people([...byOwner.keys()].filter((k) => /^[0-9a-f]{64}$/.test(k)))
  for (const [owner, folders] of byOwner) {
    const name = named[owner]?.displayName
    console.log(`\n${owner}${name ? ` (${name})` : ''} owns ${folders.length}:`)
    for (const f of folders) console.log(`    ${f.id}  ${JSON.stringify(f.name ?? '')}`)
  }
}

/**
 * The relay's roster (`kind:13534`, relay-signed, one `member` tag per member with the
 * role in the tag), which is what FOL-11's steward rule reads. Says whether
 * this identity is one.
 */
async function members(query: QueryFn, t: Token) {
  const [list] = await query([{ kinds: [13534], limit: 1 }])
  if (!list) {
    console.log('no kind:13534 on the relay — the roster is not published')
    return
  }
  const rows = list.tags.filter((tag) => tag[0] === 'member').map((tag) => ({ pubkey: tag[1], role: tag[2] ?? 'member' }))
  const people = createPeopleCache().viaRelay(query)
  const named = await people(rows.map((r) => r.pubkey))
  console.log(`${rows.length} relay member(s), signed ${new Date(list.created_at * 1000).toISOString()}:`)
  for (const r of rows) console.log(`    ${r.role.padEnd(6)} ${r.pubkey}${named[r.pubkey]?.displayName ? `  ${named[r.pubkey].displayName}` : ''}${r.pubkey === t.pubkey ? '  ← this identity' : ''}`)
}

/**
 * Is FOL-11 deployed? Built is not deployed, so read the relay's answer to
 * two `9008`s and compare the reasons, never the image tag.
 *
 * The control is a `9008` at the Peek team Folder, which holds files and
 * whose owner this identity is not. Before FOL-11 the relay says "only owner
 * can delete group"; after, a steward is told the Folder "holds N file(s)"
 * and anyone else "only the channel owner or a community admin". Nothing can
 * be deleted by this send in either version, which is why it is the control.
 * Then one `9008` at the first doomed Folder, which is what `delete` would do
 * for all of them.
 */
async function probe(p: Plan, t: Token) {
  const control = await publish(buildDeleteChannel(t.pubkey, Date.now(), { channelUuid: TEAMS.Peek }), t)
  console.log(`control 9008 ${TEAMS.Peek} (Peek, holds files) → ${control.ok ? 'ACCEPTED — this must never happen' : `refused: ${control.reason}`}`)
  // Prefer a `liv1 …` probe channel: nobody will miss one, whichever way it goes.
  const doomed = doomedFolders(p)
  const first = doomed.find((f) => /^liv1\b/.test(f.name ?? '')) ?? doomed[0]
  if (!first) {
    console.log('nothing left to delete, no positive probe')
    return
  }
  await sleep(WRITE_GAP_MS)
  const result = await publish(buildDeleteChannel(t.pubkey, Date.now(), { channelUuid: first.id }), t)
  console.log(`probe   9008 ${first.id} ${JSON.stringify(first.name ?? '')} → ${result.ok ? 'accepted' : `refused: ${result.reason}`}`)
}

async function main() {
  const mode = process.argv[2]
  const modes = ['plan', 'place', 'delete', 'owners', 'members', 'probe']
  if (!modes.includes(mode ?? '')) throw new Error(`mode: ${modes.join(' | ')}`)
  const t = await token()
  const query = queryFn(t)
  console.log(`identity ${t.pubkey.slice(0, 8)}… relay ${RELAY_URL} mode ${mode}\n`)
  if (mode === 'members') return members(query, t)
  const p = await plan(query)
  if (mode === 'plan') printPlan(p)
  if (mode === 'place') await place(p, query, t)
  if (mode === 'delete') await remove(p, query, t)
  if (mode === 'owners') await owners(p, query)
  if (mode === 'probe') await probe(p, t)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
