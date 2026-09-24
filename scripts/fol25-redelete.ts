/**
 * FOL-25, phase C: delete the old topic channels whose content now lives on a
 * file — run as the agent identity against production.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol25-redelete.ts plan
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol25-redelete.ts probe
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol25-redelete.ts replace-placement
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol25-redelete.ts delete <channel uuid>… | all
 *
 * **Which channels.** The input is `LEGACY_TOPICS` (`src/lib/legacyTopicLinks.ts`),
 * the table FOL-26 shipped in the bundle: every topic with the channel it was
 * and where its link lands now. Only a topic whose destination is a `30840`
 * is a candidate. One whose destination is a Ship project (`30850`) is a
 * record channel — the project's issues are filed there by `h`, and a `9008`
 * hides everything under its `h` — so it is never touched, whatever it holds
 * today. *For testing* has no file (CON-4 discarded it) and is not touched
 * either. The 8 FOL-11 test channels are listed by `plan` and deleted only
 * when named on the command line, after Miky has deleted their test issues.
 *
 * The earlier `delete` mode of `fol25-topics-to-files.ts` found its channels
 * through Convex's `topics:list` and kind:5'd any file filed in a channel
 * before its `9008`. This one reads no Convex and deletes nothing but the
 * channel: a channel that holds a file is refused, not emptied.
 *
 * **What is checked, per channel, immediately before its `9008`:** the
 * channel is live (its `39000` answers); nothing is filed in it
 * (`kinds:[30840,30850,30851] #h`, the three the relay's own guard counts);
 * no comment in it hangs off a file or project (a `1111` whose root is a
 * `30840`/`30850` address — hidden with the channel); no Folder state places
 * it; and its destination file answers. `plan` prints all of it and sends
 * nothing.
 *
 * **What is read back after it:** the `39000` and every `kind:9` stop
 * answering, `listFolders` no longer lists it, and the destination file and
 * its comment count are unchanged. "Accepted" alone is not a delete — see the
 * memory note on a `9008` in a channel's history (CON-10).
 *
 * `probe` is the control: a throwaway private channel this run creates, with
 * one message and one file filed in it. Its `9008` must be refused while the
 * file is there, and accepted once the file is gone; the message must answer
 * before and not after. That is what shows the readback can tell a live
 * channel from a hidden one, and it touches nothing anybody uses.
 */
import { authorizationHeaderFor, buildBareFile, buildCreateChannel, buildDeleteChannel, buildDeletion, buildUnsignedAuthEvent, toNostrSeconds } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { listFolders, type FolderSummary, type QueryFn } from '@estiva-app/interop'
import { randomUUID } from 'node:crypto'
import { LEGACY_TOPICS } from '../src/lib/legacyTopicLinks'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
/** Between writes: the relay's write quota trips after a handful in a row. */
const WRITE_GAP_MS = 6_000

/** The kinds a Folder *files*; the relay refuses a `9008` while any carries the channel's `h`. */
const FILED_KINDS = [30840, 30850, 30851]
const NEEDED_KINDS = [5, 9, 9007, 9008, 30840]

/**
 * The 8 FOL-11 test channels (two are named `new`), each holding one test
 * issue by Miky, Katerina or Ship's own key. Moved here from
 * `fol25-topics-to-files.ts`.
 */
const TEST_TOPICS = ['katerina topic', 'new', 'New test', 'new topic', 'New topic [TRACE2]', 'PEEK-72 probe', 'Project Peek <> Ship integration']

type Token = { accessToken: string; pubkey: string; allowedKinds?: number[] }

async function token(): Promise<Token> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grantType: 'client_credentials', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string; allowed_kinds?: number[] }
  return { accessToken: body.access_token, pubkey: body.pubkey, allowedKinds: body.allowed_kinds }
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

/** A refused read throws — a swallowed 403 would read as "0 events" and pass every check. */
function queryFn(t: Token): QueryFn {
  return async (filters) => {
    const { status, text } = await bridge('/query', filters, t)
    if (status !== 200) throw new Error(`POST /query: ${status} ${text}`)
    return JSON.parse(text) as SignedEvent[]
  }
}

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
  return { ok, reason: ok ? undefined : (parsed.reason ?? parsed.message ?? `${status} ${text.slice(0, 160)}`), id: signed.id }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tag = (e: SignedEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1]
const short = (s: string) => s.slice(0, 8)

type Candidate = { channel: string; title: string; file?: string; test?: boolean }

/** What the relay says about one channel now. */
type Reading = {
  live: boolean
  address?: string
  filed: SignedEvent[]
  messages: number
  /** `1111`s under this `h` whose root is a file or project — they would vanish with it. */
  foreignComments: number
  /** `30890` states that place this channel's `39000` address. */
  placedIn: string[]
  listed: boolean
  fileLive?: boolean
  fileComments?: number
}

const MESSAGE_LIMIT = 500

/**
 * A file's comments the way Peek reads them: roots by lowercase `#a`, then
 * replies by `#e`, a level at a time. Never `#A` — on production it answers
 * 78 at one limit and 0 at another for the same file (SHR-8, peek#294).
 */
async function conversationSize(file: string, query: QueryFn): Promise<number> {
  const seen = new Set<string>()
  let frontier = (await query([{ kinds: [1111], '#a': [file], limit: 2000 }])).map((e) => e.id)
  while (frontier.length) {
    for (const id of frontier) seen.add(id)
    const replies = await query([{ kinds: [1111], '#e': frontier, limit: 2000 }])
    frontier = replies.map((e) => e.id).filter((id) => !seen.has(id))
  }
  return seen.size
}

async function read(channels: string[], files: string[], query: QueryFn): Promise<Map<string, Reading>> {
  const folders = await listFolders(query)
  const listed = new Set(folders.map((f) => f.id))
  const wanted = files.filter(Boolean)
  const [metas, filed, fileEvents] = await Promise.all([
    query([{ kinds: [39000], '#d': channels, limit: 200 }]),
    query([{ kinds: FILED_KINDS, '#h': channels, limit: 2000 }]),
    wanted.length ? query([{ kinds: [30840], '#d': wanted.map((a) => a.split(':')[2]!), limit: 200 }]) : Promise.resolve([]),
  ])
  // One filter per channel, so a busy channel cannot starve a quiet one of its limit.
  const conversation = await query(channels.map((h) => ({ kinds: [9, 1111], '#h': [h], limit: MESSAGE_LIMIT })))
  const addresses = metas.map((m) => `39000:${m.pubkey}:${tag(m, 'd')}`)
  const states = addresses.length ? await query([{ kinds: [30890], '#a': addresses, limit: 200 }]) : []
  const comments = new Map<string, number>()
  for (const f of wanted) comments.set(f, await conversationSize(f, query))

  const out = new Map<string, Reading>()
  for (const [i, channel] of channels.entries()) {
    const meta = metas.find((m) => tag(m, 'd') === channel)
    const address = meta && `39000:${meta.pubkey}:${channel}`
    const inChannel = conversation.filter((e) => tag(e, 'h') === channel)
    const file = files[i]
    const fileEvent = file ? fileEvents.find((e) => `30840:${e.pubkey}:${tag(e, 'd')}` === file) : undefined
    out.set(channel, {
      live: !!meta,
      address,
      filed: filed.filter((e) => tag(e, 'h') === channel),
      messages: inChannel.length,
      foreignComments: inChannel.filter((e) => e.kind === 1111 && /^3085?0:/.test(tag(e, 'A') ?? '')).length,
      placedIn: address ? states.filter((s) => s.tags.some((t) => t[0] === 'a' && t[1] === address)).map((s) => tag(s, 'd') ?? s.id) : [],
      listed: listed.has(channel),
      fileLive: file ? !!fileEvent : undefined,
      fileComments: file ? comments.get(file) : undefined,
    })
  }
  return out
}

/** Why a channel must not be deleted now, or null when it may. */
function refusal(c: Candidate, r: Reading): string | null {
  if (!r.live) return 'not live (already deleted)'
  if (r.filed.length) return `holds ${r.filed.length} filed event(s): ${r.filed.map((e) => `${e.kind} ${short(e.id)} ${JSON.stringify(tag(e, 'title') ?? tag(e, 'name') ?? '')}`).join(', ')}`
  if (r.foreignComments) return `${r.foreignComments} comment(s) on a file or project carry this h`
  if (r.placedIn.length) return `placed by the state of ${r.placedIn.join(', ')}`
  if (c.file && !r.fileLive) return `destination ${c.file} does not answer`
  return null
}

function candidates(folders: FolderSummary[]): { topics: Candidate[]; kept: Candidate[]; tests: Candidate[] } {
  const topics: Candidate[] = []
  const kept: Candidate[] = []
  for (const t of LEGACY_TOPICS) {
    if ('file' in t && t.file.startsWith('30840:')) topics.push({ channel: t.channel, title: t.title, file: t.file })
    else kept.push({ channel: t.channel, title: t.title, file: 'file' in t ? t.file : undefined })
  }
  const tests = folders.filter((f) => !f.hasState && TEST_TOPICS.includes(f.name ?? '')).map((f) => ({ channel: f.id, title: f.name ?? '', test: true }))
  return { topics, kept, tests }
}

function line(c: Candidate, r: Reading): string {
  const file = c.file ? `  file ${r.fileLive ? 'answers' : 'MISSING'} (${r.fileComments} comments)` : ''
  const msgs = r.messages >= MESSAGE_LIMIT ? `≥${MESSAGE_LIMIT}` : String(r.messages)
  return `${c.channel}  ${r.live ? 'live' : 'gone'}${r.listed ? '' : ' unlisted'}  ${msgs} msg  ${r.filed.length} filed${file}  ${JSON.stringify(c.title)}`
}

async function plan(query: QueryFn, t: Token) {
  const missing = NEEDED_KINDS.filter((k) => t.allowedKinds && !t.allowedKinds.includes(k))
  console.log(`ceiling: ${t.allowedKinds ? (missing.length ? `MISSING ${missing.join(', ')}` : `has ${NEEDED_KINDS.join(', ')}`) : 'not reported'}`)
  const [roster] = await query([{ kinds: [13534], limit: 1 }])
  const role = roster?.tags.find((x) => x[0] === 'member' && x[1] === t.pubkey)?.[2]
  console.log(`relay role: ${role ?? 'none'} (a 9008 at a channel it does not own needs owner or admin)\n`)

  const folders = await listFolders(query)
  const { topics, kept, tests } = candidates(folders)
  const all = [...topics, ...tests]
  const readings = await read(all.map((c) => c.channel), all.map((c) => c.file ?? ''), query)

  console.log(`${topics.length} topic channel(s) with a file:`)
  for (const c of topics) {
    const r = readings.get(c.channel)!
    const why = refusal(c, r)
    console.log(`  ${why ? 'keep  ' : 'DELETE'} ${line(c, r)}${why ? `\n           ${why}` : ''}`)
    // Who put it there: deleting it would leave a dead `a` in that Folder's state (FOL-28).
    for (const parent of r.placedIn) {
      const commands = await query([{ kinds: [1852], '#h': [parent], '#a': [r.address!], limit: 20 }])
      for (const e of commands) console.log(`           1852 ${tag(e, 'op')} by ${short(e.pubkey)} ${new Date(e.created_at * 1000).toISOString().slice(0, 16)}`)
    }
  }
  console.log(`\n${kept.length} never touched (project record channels and For testing):`)
  for (const c of kept) console.log(`         ${c.channel}  ${JSON.stringify(c.title)} → ${c.file ? short(c.file.split(':')[2]!) : 'team'}`)
  console.log(`\n${tests.length} FOL-11 test channel(s), deleted only by name:`)
  for (const c of tests) {
    const r = readings.get(c.channel)!
    const why = refusal(c, r)
    console.log(`  ${why ? 'keep  ' : 'ready '} ${line(c, r)}${why ? `\n           ${why}` : ''}`)
    for (const e of r.filed) console.log(`           ${e.kind} by ${short(e.pubkey)}: ${JSON.stringify(tag(e, 'title') ?? '')}`)
  }
}

/** The control: a channel this run creates, refused while it holds a file and deleted once it does not. */
async function probe(query: QueryFn, t: Token) {
  const channel = randomUUID()
  const fileId = randomUUID()
  let ok = true
  const step = (what: string, good: boolean, detail = '') => {
    if (!good) ok = false
    console.log(`  ${good ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`)
  }
  const count = async () => {
    const [meta, msgs, filed] = await Promise.all([
      query([{ kinds: [39000], '#d': [channel], limit: 5 }]),
      query([{ kinds: [9], '#h': [channel], limit: 5 }]),
      query([{ kinds: FILED_KINDS, '#h': [channel], limit: 5 }]),
    ])
    return { meta: meta.length, msgs: msgs.length, filed: filed.length, listed: (await listFolders(query)).some((f) => f.id === channel) }
  }

  console.log(`control channel ${channel}`)
  const created = await publish(buildCreateChannel(t.pubkey, Date.now(), { channelUuid: channel, name: `fol25 control ${short(channel)}`, visibility: 'private' }), t)
  step('9007 create', created.ok, created.reason)
  if (!created.ok) return
  await sleep(WRITE_GAP_MS)
  const message = await publish({ pubkey: t.pubkey, created_at: toNostrSeconds(Date.now()), kind: 9, tags: [['h', channel]], content: 'fol25 control message' }, t)
  step('kind:9 message', message.ok, message.reason)
  await sleep(WRITE_GAP_MS)
  const file = await publish(buildBareFile(t.pubkey, Date.now(), { fileId, title: `fol25 control ${short(fileId)}`, channelUuid: channel }), t)
  step('30840 filed in it', file.ok, file.reason)
  await sleep(WRITE_GAP_MS)

  const before = await count()
  step('before: 39000, message and file answer, listed', before.meta === 1 && before.msgs === 1 && before.filed === 1 && before.listed, JSON.stringify(before))

  const refused = await publish(buildDeleteChannel(t.pubkey, Date.now(), { channelUuid: channel }), t)
  step('9008 refused while a file is filed', !refused.ok, refused.ok ? 'ACCEPTED — the relay guard is not deployed' : refused.reason)
  await sleep(WRITE_GAP_MS)
  if (refused.ok) return

  const removed = await publish(buildDeletion(t.pubkey, Date.now(), { targetEventId: file.id }), t)
  step('kind:5 the file', removed.ok, removed.reason)
  await sleep(WRITE_GAP_MS)
  const deleted = await publish(buildDeleteChannel(t.pubkey, Date.now(), { channelUuid: channel }), t)
  step('9008 accepted once empty', deleted.ok, deleted.reason)
  await sleep(2_000)

  const after = await count()
  step('after: 39000 and message hidden, unlisted', after.meta === 0 && after.msgs === 0 && !after.listed, JSON.stringify(after))
  console.log(`\ncontrol ${ok ? 'passed' : 'FAILED — do not run delete'}`)
}

/**
 * A topic channel placed in another Folder's state is refused by `delete`:
 * deleting it would leave a dead `a` there (FOL-28). The channel's content is
 * its file now, so the placement moves to the file — `add` first, `remove`
 * second, so the Folder never draws neither — and the state is read back.
 */
async function replacePlacement(query: QueryFn, t: Token) {
  if (t.allowedKinds && !t.allowedKinds.includes(1852)) throw new Error('the ceiling has no kind:1852')
  const { topics } = candidates(await listFolders(query))
  const readings = await read(topics.map((c) => c.channel), topics.map((c) => c.file ?? ''), query)
  for (const c of topics) {
    const r = readings.get(c.channel)!
    if (!r.live || !r.placedIn.length || !c.file) continue
    for (const parent of r.placedIn) {
      for (const [op, address] of [['add', c.file], ['remove', r.address!]] as const) {
        const result = await publish({ pubkey: t.pubkey, created_at: toNostrSeconds(Date.now()), kind: 1852, tags: [['h', parent], ['op', op], ['a', address]], content: '' }, t)
        console.log(`1852 ${op.padEnd(6)} ${short(parent)} ${address.slice(0, 20)}… ${JSON.stringify(c.title)} → ${result.ok ? 'accepted' : `REFUSED ${result.reason}`}`)
        await sleep(WRITE_GAP_MS)
        if (!result.ok) break
      }
      const [state] = await query([{ kinds: [30890], '#d': [parent], limit: 1 }])
      const holds = (a: string) => !!state?.tags.some((x) => x[0] === 'a' && x[1] === a)
      console.log(`       ${holds(c.file) ? '✓' : '✗'} ${short(parent)}'s state places the file`)
      console.log(`       ${holds(r.address!) ? '✗' : '✓'} ${short(parent)}'s state no longer places the channel`)
    }
  }
}

async function remove(query: QueryFn, t: Token, names: string[]) {
  const folders = await listFolders(query)
  const { topics, tests } = candidates(folders)
  const pool = [...topics, ...tests]
  const chosen = names.includes('all') ? topics : pool.filter((c) => names.includes(c.channel))
  const unknown = names.filter((n) => n !== 'all' && !pool.some((c) => c.channel === n))
  if (unknown.length) throw new Error(`not a candidate: ${unknown.join(', ')} — a project record channel is never one`)

  let deleted = 0
  for (const c of chosen) {
    // Re-read right before the write: the plan a person looked at may be stale.
    const r = (await read([c.channel], [c.file ?? ''], query)).get(c.channel)!
    const why = refusal(c, r)
    if (why) {
      console.log(`skip   ${c.channel} ${JSON.stringify(c.title)}: ${why}`)
      continue
    }
    const result = await publish(buildDeleteChannel(t.pubkey, Date.now(), { channelUuid: c.channel }), t)
    console.log(`9008   ${c.channel} ${JSON.stringify(c.title)} → ${result.ok ? `accepted ${short(result.id)}` : `REFUSED ${result.reason}`}`)
    await sleep(WRITE_GAP_MS)
    if (!result.ok) continue

    const a = (await read([c.channel], [c.file ?? ''], query)).get(c.channel)!
    const checks: Array<[string, boolean]> = [
      ['39000 hidden', !a.live],
      [`messages hidden (${r.messages} → ${a.messages})`, a.messages === 0],
      ['unlisted', !a.listed],
      ...(c.file ? ([[`file answers, ${r.fileComments} → ${a.fileComments} comments`, !!a.fileLive && a.fileComments === r.fileComments]] as Array<[string, boolean]>) : []),
    ]
    for (const [what, good] of checks) console.log(`       ${good ? '✓' : '✗'} ${what}`)
    if (checks.every(([, good]) => good)) deleted++
  }
  console.log(`\n${deleted} of ${chosen.length} deleted and read back`)
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2)
  if (!['plan', 'probe', 'replace-placement', 'delete'].includes(mode ?? '')) throw new Error('mode: plan | probe | replace-placement | delete <channel uuid>… | all')
  if (mode === 'delete' && !rest.length) throw new Error('delete: name the channel uuids, or all for every topic channel with a file')
  const t = await token()
  const query = queryFn(t)
  console.log(`identity ${short(t.pubkey)}… relay ${RELAY_URL} mode ${mode}\n`)
  if (mode === 'plan') await plan(query, t)
  if (mode === 'probe') await probe(query, t)
  if (mode === 'replace-placement') await replacePlacement(query, t)
  if (mode === 'delete') await remove(query, t, rest)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
