/**
 * FOL-25: the 25 old topic channels become bare files in their team, or are
 * deleted — run as the agent identity against production.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol25-topics-to-files.ts survey
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol25-topics-to-files.ts migrate
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol25-topics-to-files.ts delete
 *
 * `survey` reads and prints what each topic holds — messages, authors, dates,
 * attachments, files — which is the input to Miky's per-topic triage. The
 * triage itself is `TRIAGE` below: `file` re-creates the topic as a `30840`
 * in its team and re-posts its conversation as agent-signed `1111` comments
 * carrying "originally by X, date"; `bare` re-creates the file and drops the
 * conversation; `delete` sends nothing but the `9008`.
 *
 * Messages cannot be re-signed, so a re-post is lossy on authorship by design
 * (the issue says so). `migrate` writes and re-reads; `delete` sends the
 * `9008`s the relay now lets an admin send (buzz#16/#17) and re-reads
 * `listFolders`.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor, buildDeleteChannel, buildBareFile, buildDeletion, toNostrSeconds } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { createPeopleCache, listFolders, type FolderSummary, type QueryFn } from '@estiva-app/interop'
import { randomUUID } from 'node:crypto'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
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

type Fate = 'file' | 'bare' | 'delete' | 'ask'

/**
 * Miky's sort into teams (FOL-22, 2026-09-14) and triage (FOL-25, 2026-09-15):
 * the five empty topics are kept as bare files; the test topic, the empty
 * Steer one and the archived project's agent log are deleted; the rest are
 * re-posted. `ask` is a topic nobody has decided on yet: `migrate` and
 * `delete` both skip it and say so, so a run before the triage is complete
 * cannot touch it.
 */
const TRIAGE: Array<[string, keyof typeof TEAMS, Fate]> = [
  ['AI Tips', 'Estiva HQ', 'file'],
  ['Alternatives to Estiva / Peek', 'Estiva HQ', 'file'],
  ['Claude on Estiva / Estiva Steer', 'Steer', 'file'],
  ['Conversation across apps', 'Peek', 'file'],
  ['Estiva Suits Updates', 'Estiva HQ', 'file'],
  ['Feedback on Peek', 'Peek', 'file'],
  ['Feedback on Ship', 'Ship', 'file'],
  ['Folders: Universal navigation concept', 'Estiva HQ', 'file'],
  ['For testing', 'Peek', 'delete'],
  ['Intelligence in Peek', 'Peek', 'file'],
  ['Interesting Claude-generated docs - Renamed 4', 'Steer', 'delete'],
  ['Local & AI development', 'Estiva HQ', 'file'],
  ['Pitch for Nostr for Business', 'Estiva HQ', 'bare'],
  ['Planning and sequencing', 'Estiva HQ', 'file'],
  ['Project: Catch up the Buzz fork', 'Peek', 'delete'],
  ['Project: Cross-app read state', 'Peek', 'file'],
  ['Project: DMs on Nostr (DM channels)', 'Peek', 'file'],
  ["Project: Peek's Intelligence", 'Peek', 'file'],
  ['Project: Rewrite Ship with shared foundation', 'Ship', 'file'],
  ['Project: Shared foundation packages', 'Estiva HQ', 'file'],
  ['Scenarios to demonstrate Nostr for Business', 'Estiva HQ', 'bare'],
  ['Widgets', 'Estiva HQ', 'file'],
  ['Domain name - brainstorming', 'Estiva HQ', 'bare'],
  ['Peek vision - initial notes', 'Peek', 'bare'],
  ['Researching using Buzz "backend" to power Peek', 'Peek', 'bare'],
]

/**
 * The 8 test topics the FOL-11 run refused. Each holds one test **issue**
 * (`30851`, by Miky, Katerina or Ship's own key — not a `30840`, which is
 * what the ticket assumed), and a `kind:5` is the author's to send, so the
 * `9008` is refused until the issue is deleted in Ship. Read off `plan` on
 * 2026-09-15; `delete` re-reads and refuses any bare Folder not in this list
 * rather than guessing.
 *
 * Nine of the 25 topics are refused the same way, for a better reason: they
 * were the Peek half of a paired Ship project ("Feedback on Peek", the six
 * "Project: …" ones, …) and hold 148 issues by `h` between them — record
 * Folders in substance, which FOL-25 says never to delete. The relay's count
 * is the guard; the run reports the refusal and moves on.
 */
const TEST_TOPICS = [
  'katerina topic',
  'new',
  'New test',
  'new topic',
  'New topic [TRACE2]',
  'PEEK-72 probe',
  'Project Peek <> Ship integration',
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

/** A run of 549 re-posts outlives the access token (~1 h); a 401 mints a new one and retries once. */
async function sign(unsigned: UnsignedEvent, t: Token, retried = false): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t.accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (res.status === 401 && !retried) {
    t.accessToken = (await token()).accessToken
    return sign(unsigned, t, true)
  }
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
const tag = (e: SignedEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1]
const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10)

/** Convex holds the titles the sort names (one topic was renamed there only). */
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

type Topic = {
  name: string
  team: keyof typeof TEAMS
  fate: Fate
  uuid: string
  /** `39000:<pubkey>:<uuid>` */
  address: string
  /** kind:9 and kind:1111, oldest first, edits folded in, deleted ones dropped */
  messages: SignedEvent[]
  files: SignedEvent[]
}

/**
 * A topic's conversation the way Peek renders it: `kind:9` and `kind:1111`
 * under its `h`, minus anything a `kind:5` by its author named, with the
 * latest `kind:40003` edit's content in place of the original's.
 */
async function readTopic(uuid: string, query: QueryFn): Promise<Pick<Topic, 'messages' | 'files'>> {
  const events = await query([
    { kinds: [9, 1111], '#h': [uuid], limit: 2000 },
    { kinds: [5, 40003], '#h': [uuid], limit: 2000 },
    { kinds: [30840], '#h': [uuid], limit: 100 },
  ])
  const deleted = new Set(events.filter((e) => e.kind === 5).flatMap((e) => e.tags.filter((t) => t[0] === 'e').map((t) => t[1])))
  const edits = new Map<string, SignedEvent>()
  for (const e of events.filter((e) => e.kind === 40003)) {
    const target = tag(e, 'e')
    if (target && (edits.get(target)?.created_at ?? 0) < e.created_at) edits.set(target, e)
  }
  const messages = events
    .filter((e) => (e.kind === 9 || e.kind === 1111) && !deleted.has(e.id))
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
    .map((e) => (edits.has(e.id) ? { ...e, content: edits.get(e.id)!.content } : e))
  return { messages, files: events.filter((e) => e.kind === 30840) }
}

async function plan(query: QueryFn): Promise<{ folders: FolderSummary[]; topics: Topic[] }> {
  const folders = await listFolders(query)
  const onRelay = new Set(folders.map((f) => f.id))
  const byTitle = await convexTopics()
  const uuids = TRIAGE.map(([name]) => {
    const uuid = byTitle.get(name)
    if (!uuid) throw new Error(`"${name}": no Convex topic with a channel carries that title`)
    return uuid
  })
  const metas = await query([{ kinds: [39000], '#d': uuids, limit: 100 }])
  const topics: Topic[] = []
  for (const [i, [name, team, fate]] of TRIAGE.entries()) {
    const uuid = uuids[i]!
    const meta = metas.find((e) => tag(e, 'd') === uuid)
    // Already gone: a topic deleted by an earlier run is not on the relay and
    // needs nothing more.
    if (!onRelay.has(uuid) || !meta) {
      topics.push({ name, team, fate, uuid, address: '', messages: [], files: [] })
      continue
    }
    topics.push({ name, team, fate, uuid, address: `39000:${meta.pubkey}:${uuid}`, ...(await readTopic(uuid, query)) })
  }
  return { folders, topics }
}

async function survey(p: { folders: FolderSummary[]; topics: Topic[] }, query: QueryFn) {
  const people = createPeopleCache().viaRelay(query)
  const authors = [...new Set(p.topics.flatMap((t) => t.messages.map((m) => m.pubkey)))]
  const named = await people(authors)
  const who = (pk: string) => named[pk]?.displayName ?? pk.slice(0, 8)
  console.log(`${p.folders.length} Folder(s) on the relay\n`)
  let total = 0
  for (const t of p.topics) {
    if (!t.address) {
      console.log(`${t.name} — gone from the relay`)
      continue
    }
    const byAuthor = new Map<string, number>()
    for (const m of t.messages) byAuthor.set(m.pubkey, (byAuthor.get(m.pubkey) ?? 0) + 1)
    const bytes = t.messages.reduce((n, m) => n + Buffer.byteLength(m.content), 0)
    const media = t.messages.filter((m) => m.tags.some((x) => x[0] === 'imeta')).length
    const replies = t.messages.filter((m) => m.tags.some((x) => x[0] === 'e')).length
    const span = t.messages.length ? `${day(t.messages[0]!.created_at)} → ${day(t.messages.at(-1)!.created_at)}` : '—'
    total += t.messages.length
    console.log(`${t.name}  [${t.team}] ${t.fate}`)
    console.log(`    ${t.uuid}  ${t.messages.length} msg (${replies} replies, ${media} with media, ${(bytes / 1024).toFixed(1)} KB)  ${span}${t.files.length ? `  ${t.files.length} file(s) filed` : ''}`)
    console.log(`    ${[...byAuthor].map(([pk, n]) => `${who(pk)} ${n}`).join(', ')}`)
  }
  console.log(`\n${total} message(s) across ${p.topics.filter((t) => t.address).length} topic(s)`)
}

/** What a re-posted message says; the original author and date are text, since the signature cannot move. */
function repost(m: SignedEvent, who: (pk: string) => string): string {
  const when = new Date(m.created_at * 1000).toISOString().replace('T', ' ').slice(0, 16)
  const media = m.tags.filter((x) => x[0] === 'imeta').map((x) => x.find((f) => f.startsWith('url '))?.slice(4)).filter(Boolean)
  return `*originally by ${who(m.pubkey)}, ${when} UTC*\n\n${m.content}${media.length ? '\n\n' + media.join('\n') : ''}`
}

async function migrate(p: { folders: FolderSummary[]; topics: Topic[] }, query: QueryFn, t: Token) {
  const people = createPeopleCache().viaRelay(query)
  const named = await people([...new Set(p.topics.flatMap((x) => x.messages.map((m) => m.pubkey)))])
  const who = (pk: string) => named[pk]?.displayName ?? pk.slice(0, 8)
  for (const topic of p.topics) {
    if (!topic.address) continue
    if (topic.fate === 'ask') {
      console.log(`${topic.name}: no triage yet, skipped`)
      continue
    }
    if (topic.fate === 'delete') continue
    const team = TEAMS[topic.team]!
    // Idempotent: a file with this title already in the team is the one an
    // earlier run made, so its conversation is what is compared, not re-sent.
    const existing = (await query([{ kinds: [30840], '#h': [team], authors: [t.pubkey], limit: 200 }])).find((e) => tag(e, 'title') === topic.name)
    const fileId = existing ? tag(existing, 'd')! : randomUUID()
    if (!existing) {
      const r = await publish(buildBareFile(t.pubkey, Date.now(), { fileId, title: topic.name, channelUuid: team }), t)
      console.log(`${topic.name}: 30840 ${fileId} in ${topic.team} → ${r.ok ? 'accepted' : `REFUSED ${r.reason}`}`)
      if (!r.ok) continue
      await sleep(WRITE_GAP_MS)
    } else {
      console.log(`${topic.name}: 30840 ${fileId} already in ${topic.team}`)
    }
    if (topic.fate === 'bare') continue
    const address = `30840:${t.pubkey}:${fileId}`
    const posted = await query([{ kinds: [1111], '#a': [address], authors: [t.pubkey], limit: 2000 }])
    const done = new Set(posted.map((e) => e.tags.find((x) => x[0] === 'orig')?.[1]))
    let n = 0
    for (const m of topic.messages) {
      if (done.has(m.id)) continue
      const unsigned: UnsignedEvent = {
        pubkey: t.pubkey,
        created_at: toNostrSeconds(Date.now()),
        kind: 1111,
        tags: [
          ['A', address], ['K', '30840'], ['P', t.pubkey],
          ['a', address], ['k', '30840'], ['p', t.pubkey],
          ['h', team],
          ['ts', String(Date.now())],
          // The message this stands in for — what makes a re-run skip it.
          ['orig', m.id, String(m.created_at), m.pubkey],
        ],
        content: repost(m, who),
      }
      const r = await publish(unsigned, t)
      if (!r.ok) {
        console.log(`    ${m.id.slice(0, 8)} → REFUSED ${r.reason}; stopping this topic`)
        break
      }
      n++
      await sleep(WRITE_GAP_MS)
    }
    const after = await query([{ kinds: [1111], '#a': [address], authors: [t.pubkey], limit: 2000 }])
    console.log(`    re-posted ${n}; relay now holds ${after.length} of ${topic.messages.length}`)
  }
}

async function remove(p: { folders: FolderSummary[]; topics: Topic[] }, query: QueryFn, t: Token) {
  const doomed: Array<{ id: string; name: string; files: SignedEvent[] }> = []
  for (const topic of p.topics) {
    if (!topic.address) continue
    if (topic.fate === 'ask') {
      console.log(`${topic.name}: no triage yet, kept`)
      continue
    }
    if (topic.fate !== 'delete') {
      // A migrated topic's file must exist before its channel goes.
      const file = (await query([{ kinds: [30840], '#h': [TEAMS[topic.team]!], authors: [t.pubkey], limit: 200 }])).find((e) => tag(e, 'title') === topic.name)
      if (!file) {
        console.log(`${topic.name}: no file in ${topic.team} yet, kept — run migrate first`)
        continue
      }
    }
    doomed.push({ id: topic.uuid, name: topic.name, files: topic.files })
  }
  for (const f of p.folders) {
    if (f.hasState || !TEST_TOPICS.includes(f.name ?? '')) continue
    const { files } = await readTopic(f.id, query)
    doomed.push({ id: f.id, name: f.name ?? '', files })
  }
  const refused: string[] = []
  for (const [i, d] of doomed.entries()) {
    // The relay refuses a 9008 while a 30840 is filed in the channel; the
    // file's author (this identity, for all 8 test topics) deletes it first.
    for (const file of d.files) {
      const r = await publish(buildDeletion(t.pubkey, Date.now(), { targetEventId: file.id }), t)
      console.log(`    kind:5 ${file.id.slice(0, 8)} (${tag(file, 'title')}) → ${r.ok ? 'accepted' : `REFUSED ${r.reason}`}`)
      await sleep(WRITE_GAP_MS)
    }
    const result = await publish(buildDeleteChannel(t.pubkey, Date.now(), { channelUuid: d.id }), t)
    console.log(`${String(i + 1).padStart(3)}/${doomed.length} 9008 ${d.id} ${JSON.stringify(d.name)} → ${result.ok ? 'accepted' : `REFUSED ${result.reason}`}`)
    if (!result.ok) refused.push(d.id)
    await sleep(WRITE_GAP_MS)
  }
  const after = await listFolders(query)
  console.log(`\nlistFolders now: ${after.length}; refused: ${refused.length}`)
  for (const f of after) if (!/^project-[0-9a-f]{8}$/.test(f.name ?? '')) console.log(`    ${f.id}  ${f.hasState ? 'state' : 'bare '}  ${JSON.stringify(f.name ?? '')}`)
}

async function main() {
  const mode = process.argv[2]
  const modes = ['survey', 'migrate', 'delete']
  if (!modes.includes(mode ?? '')) throw new Error(`mode: ${modes.join(' | ')}`)
  const t = await token()
  const query = queryFn(t)
  console.log(`identity ${t.pubkey.slice(0, 8)}… relay ${RELAY_URL} mode ${mode}\n`)
  const p = await plan(query)
  if (mode === 'survey') await survey(p, query)
  if (mode === 'migrate') await migrate(p, query, t)
  if (mode === 'delete') await remove(p, query, t)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
