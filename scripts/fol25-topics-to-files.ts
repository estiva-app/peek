/**
 * FOL-25: the 25 old topic channels become bare files in their team, or are
 * deleted — run as the agent identity against production.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol25-topics-to-files.ts survey
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol25-topics-to-files.ts migrate
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol25-topics-to-files.ts unmigrate
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol25-topics-to-files.ts remigrate
 *   npx tsx --tsconfig tsconfig.app.json scripts/fol25-topics-to-files.ts verify
 *
 * `survey` reads and prints what each topic holds — messages, authors, dates,
 * attachments, files — which is the input to Miky's per-topic triage. The
 * triage itself is `TRIAGE` below: `file` re-creates the topic as a `30840`
 * in its team and re-posts its conversation; `bare` re-creates the file and
 * drops the conversation; `delete` sends nothing but the `9008`.
 *
 * `migrate` writes and re-reads; `unmigrate` takes a copy back down. Deleting
 * the channels is `scripts/fol25-redelete.ts` (FOL-25 phase C), which replaced
 * the `delete` mode that lived here.
 *
 * **"Messages cannot be re-signed" was wrong**, and it was the sentence this
 * file was built on. They cannot be re-signed *by the agent* — but an author's
 * own key signs an author's own message, which is what {@link remigrate} does
 * with keys Miky exports from Estiva ID (FOL-25, Miky's review 2026-09-15).
 * It also threads the copies, which `migrate` did not: every one of its 549
 * re-posts named the file as its parent. What it cannot recover is the
 * original `created_at` — read {@link remigrate} before assuming otherwise,
 * because the reason is structural and two of the obvious workarounds fail
 * silently. `verify` is the done-when, read-only.
 *
 * **`remigrate` needs the topic channels readable.** A `9008` hides every
 * message under its `h`, so the nine files whose topics `delete` removed have
 * no readable originals until `channels.deleted_at` is cleared on the box. It
 * refuses to start rather than trading good copies for nothing.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor, buildBareFile, buildDeletion, toNostrSeconds, signEvent, publicKeyFromSecret } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { createPeopleCache, listFolders, type FolderSummary, type QueryFn } from '@estiva-app/interop'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

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

/**
 * Who signs — the agent through `/sign`, or an author from a raw key.
 *
 * `remigrate` needs both, and needs them to move together: `ingest.rs:2386`
 * refuses an event whose `pubkey` differs from the NIP-98 identity that
 * carried it ("event pubkey does not match authenticated identity"), so an
 * author-signed `1111` must travel under an author-signed auth event. Passing
 * one signer for both is what makes that impossible to get wrong.
 */
type Signer = { pubkey: string; sign: (u: UnsignedEvent) => Promise<SignedEvent> }

const agentSigner = (t: Token): Signer => ({ pubkey: t.pubkey, sign: (u) => sign(u, t) })
const keySigner = (secretHex: string): Signer => {
  const pubkey = publicKeyFromSecret(secretHex)
  return { pubkey, sign: async (u) => signEvent(u, secretHex) }
}

async function bridge(path: '/query' | '/events', payload: unknown, s: Signer): Promise<{ status: number; text: string }> {
  const url = `${RELAY_URL}${path}`
  const body = JSON.stringify(payload)
  const auth = await s.sign(buildUnsignedAuthEvent({ pubkey: s.pubkey, url, method: 'POST', body }))
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  return { status: res.status, text: await res.text() }
}

function queryFn(s: Signer): QueryFn {
  return async (filters) => {
    const { status, text } = await bridge('/query', filters, s)
    if (status !== 200) throw new Error(`POST /query: ${status} ${text}`)
    return JSON.parse(text) as SignedEvent[]
  }
}

/**
 * Publish one event, signed and authenticated by the same identity.
 *
 * The relay refuses in two shapes and both matter here: `200` with
 * `accepted: false` for a rule it can state, and a bare `500` for the
 * commit-time `created_at` floor, which aborts inside the transaction and so
 * never reaches the code that writes a reason (see {@link remigrate}).
 */
async function publish(unsigned: UnsignedEvent, s: Signer): Promise<{ ok: boolean; status: number; reason?: string; id: string }> {
  const signed = await s.sign(unsigned)
  const { status, text } = await bridge('/events', signed, s)
  let parsed: { accepted?: boolean; reason?: string; message?: string } = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  const ok = status === 200 && parsed.accepted !== false
  return { ok, status, reason: ok ? undefined : (parsed.reason ?? parsed.message ?? `${status} ${text.slice(0, 120)}`), id: signed.id }
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
  /** `39000:<pubkey>:<uuid>`, empty once the channel is deleted. */
  address: string
  /**
   * Whether the channel is still in `listFolders` — which is also whether its
   * conversation is readable at all.
   *
   * A `9008` is one `UPDATE channels SET deleted_at = NOW()`
   * (`buzz-db/src/channel.rs:1877`); it tombstones no message row, but every
   * read joins the channel, so the messages stop answering — to an `#h` filter
   * and to an `ids:` lookup alike. `remigrate` needs the originals, so it has
   * to tell "this topic was empty" from "this topic is invisible", and only
   * this flag does.
   */
  live: boolean
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
    const live = onRelay.has(uuid) && !!meta
    // The read is attempted either way. A topic an earlier run deleted needs
    // nothing more from `migrate` or `delete`, but `remigrate` has to know
    // whether its conversation came back — and a deleted channel and an empty
    // one both answer zero, so the two facts are recorded separately.
    topics.push({
      name,
      team,
      fate,
      uuid,
      live,
      address: live ? `39000:${meta.pubkey}:${uuid}` : '',
      ...(await readTopic(uuid, query)),
    })
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
    if (!t.live) {
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
  console.log(`\n${total} message(s) across ${p.topics.filter((t) => t.live).length} topic(s)`)
}

/** What a re-posted message says; the original author and date are text, since the signature cannot move. */
function repost(m: SignedEvent, who: (pk: string) => string): string {
  const when = new Date(m.created_at * 1000).toISOString().replace('T', ' ').slice(0, 16)
  const media = m.tags.filter((x) => x[0] === 'imeta').map((x) => x.find((f) => f.startsWith('url '))?.slice(4)).filter(Boolean)
  return `*originally by ${who(m.pubkey)}, ${when} UTC*\n\n${m.content}${media.length ? '\n\n' + media.join('\n') : ''}`
}

async function migrate(p: { folders: FolderSummary[]; topics: Topic[] }, query: QueryFn, t: Signer) {
  const people = createPeopleCache().viaRelay(query)
  const named = await people([...new Set(p.topics.flatMap((x) => x.messages.map((m) => m.pubkey)))])
  const who = (pk: string) => named[pk]?.displayName ?? pk.slice(0, 8)
  for (const topic of p.topics) {
    if (!topic.live) continue
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

/**
 * Take back a migrated copy whose channel turned out to be a record Folder:
 * the relay refused its `9008` because it holds Ship issues, so the topic
 * stays and the re-posted file duplicates a conversation that is still live
 * (Miky, 2026-09-15: never keep both). A topic still in `listFolders` after
 * `delete`, and not triaged `delete`, is one; its file and every comment
 * under it are this identity's, so a `kind:5` each is ours to send. One
 * deletion per event: the relay's rule is written for one target.
 */
async function unmigrate(p: { folders: FolderSummary[]; topics: Topic[] }, query: QueryFn, t: Signer) {
  const onRelay = new Set(p.folders.map((f) => f.id))
  for (const topic of p.topics) {
    if (topic.fate === 'delete' || topic.fate === 'ask' || !onRelay.has(topic.uuid)) continue
    const team = TEAMS[topic.team]!
    const file = (await query([{ kinds: [30840], '#h': [team], authors: [t.pubkey], limit: 200 }])).find((e) => tag(e, 'title') === topic.name)
    if (!file) {
      console.log(`${topic.name}: no copy in ${topic.team}, nothing to take back`)
      continue
    }
    const address = `30840:${t.pubkey}:${tag(file, 'd')}`
    const comments = await query([{ kinds: [1111], '#a': [address], authors: [t.pubkey], limit: 2000 }])
    console.log(`${topic.name}: channel still on the relay; taking back ${comments.length} comment(s) and the file`)
    let refused = 0
    for (const e of [...comments, file]) {
      const r = await publish(buildDeletion(t.pubkey, Date.now(), { targetEventId: e.id }), t)
      if (!r.ok) {
        refused++
        console.log(`    kind:5 ${e.id.slice(0, 8)} → REFUSED ${r.reason}`)
      }
      await sleep(WRITE_GAP_MS)
    }
    const left = await query([{ kinds: [1111], '#a': [address], authors: [t.pubkey], limit: 2000 }, { kinds: [30840], '#d': [tag(file, 'd')!], authors: [t.pubkey], limit: 1 }])
    console.log(`    refused ${refused}; relay now answers ${left.length} event(s) for the copy`)
  }
}

/**
 * The authors' secret keys — `{"<pubkey hex>": "<secret hex>"}`, exported from
 * Estiva ID on the box and never leaving the machine that runs this.
 *
 * The agent's own key is not wanted here and is not asked for: it signs its
 * own messages through `/sign`, the way every other mode does.
 *
 * Each key is checked against the pubkey it is filed under before anything is
 * written. A mis-pasted key otherwise surfaces as a refusal from the relay
 * with nothing to connect it to the line that caused it.
 */
function loadKeys(): Map<string, string> {
  const path = process.env.FOL25_KEYS ?? `${homedir()}/.fol25-keys.json`
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`${path}: not found — remigrate signs as the authors and needs {"<pubkey>": "<secret>"} for each. \`survey\` names them.`)
  }
  const out = new Map<string, string>()
  for (const [pubkey, secret] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
    let derived: string
    try {
      derived = publicKeyFromSecret(secret)
    } catch (e) {
      throw new Error(`${path}: the value filed under ${pubkey.slice(0, 8)}… is not a secret key (${String(e)})`)
    }
    if (derived !== pubkey) throw new Error(`${path}: the key filed under ${pubkey.slice(0, 8)}… derives ${derived.slice(0, 8)}…`)
    out.set(pubkey, secret)
  }
  return out
}

const origOf = (e: SignedEvent) => e.tags.find((x) => x[0] === 'orig')?.[1]

/**
 * What `remigrate` writes, so a copy can say which run made it.
 *
 * Needed because "the agent's copies" stops identifying the old stand-ins the
 * moment the agent signs its own messages properly — two thirds of these
 * conversations are its own, and a correct re-post of one is agent-signed with
 * an `orig` tag, exactly like the thing being replaced. Without the marker a
 * resumed run would re-post every agent-authored message a second time, and
 * `verify` could not tell a finished file from an untouched one.
 */
const MARK = 'fol25-remigrate'
const remigrated = (e: SignedEvent) => e.tags.some((x) => x[0] === 'migration' && x[1] === MARK)

/**
 * The message this one answers, or nothing for a top-level message.
 *
 * `threadTags` writes `['e', root, '', 'root']` and `['e', parent, '',
 * 'reply']`, collapsing to a single `reply`-marked tag when the two are the
 * same — so the marker names the parent in both shapes. The last `e` is the
 * fallback for anything written before the markers.
 */
function parentOf(m: SignedEvent): string | undefined {
  const es = m.tags.filter((x) => x[0] === 'e')
  if (!es.length) return undefined
  return (es.find((x) => x[3] === 'reply') ?? es[es.length - 1]!)[1]
}

const stamp = (s: number) => `${new Date(s * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC`

/**
 * Re-post each migrated conversation as its authors, threaded, and take the
 * agent's stand-ins back down.
 *
 * ## What `migrate` got wrong, and what this can and cannot put right
 *
 * Miky's review, 2026-09-15: an author is a signature, not a line of italics;
 * and every copy named the *file* as its parent, so a thread of 37 replies
 * rendered as 37 top-level messages. Both are fixed here — the copy is signed
 * with the author's own key, and a reply's `e`/`k`/`p` name the parent's new
 * copy (`foreign.ts` §replyToCommentAsViewer is the shape, NIP-22 §6.4 the
 * authority). The originals' `imeta` come across as tags rather than as URLs
 * appended to the text.
 *
 * **The original `created_at` cannot come with them.** Migration 0021 arms a
 * `DEFERRABLE INITIALLY DEFERRED` trigger on `events` and the writer pool sets
 * its GUC to `replica_fence::CREATED_AT_FLOOR_SECS`, which is **960 seconds**:
 * a row with `channel_id IS NOT NULL` older than that is aborted at COMMIT and
 * the caller sees a bare `500`. `BUZZ_MAX_TIMESTAMP_DRIFT_SECS` does not reach
 * it — its own doc comment says so, measured 2026-08-27 — because it gates
 * ingest, not commit, and its single structural exemption is `channel_id IS
 * NULL`. Every copy here carries an `h`. The run tries the true timestamp on
 * its first write anyway, because a constant read out of a branch is not the
 * same as the image that is deployed, and falls back on the refusal.
 *
 * The ticket's fallback — keep the original time in a `ts` tag — does not
 * work either, and quietly: `orderingMs` (interop `projection.js`) ignores any
 * `ts` more than a second from `created_at`, precisely so a pushy client
 * cannot date an event into next year. So the true time goes where something
 * reads it: the `orig` tag, machine-readably, and one italic line above the
 * message for a person. `FOL25_DATE_LINE=0` drops the line.
 *
 * ## Fail closed, before the first write
 *
 * A `9008` hides its channel's messages from every read, so the nine files
 * whose topics `delete` removed have unreadable originals until somebody
 * clears `channels.deleted_at` on the box. A run that started anyway would
 * delete 134 good copies and re-post nothing. So every file is planned first —
 * originals present, a key for every author — and one problem stops the run
 * with nothing written.
 *
 * Within a file, re-post first and delete second, so an interruption leaves
 * two copies rather than none. A re-run skips what is already there: the
 * author-signed copies carry the same `orig` tag, and they are what the
 * orig→new id map is rebuilt from.
 */
async function remigrate(p: { folders: FolderSummary[]; topics: Topic[] }, query: QueryFn, t: Signer) {
  const keys = loadKeys()
  const dateLine = process.env.FOL25_DATE_LINE !== '0'
  type Job = { topic: Topic; address: string; agentCopies: SignedEvent[]; done: Map<string, SignedEvent> }
  const jobs: Job[] = []
  const problems: string[] = []

  for (const topic of p.topics) {
    if (topic.fate !== 'file') continue
    const team = TEAMS[topic.team]!
    const file = (await query([{ kinds: [30840], '#h': [team], authors: [t.pubkey], limit: 200 }])).find((e) => tag(e, 'title') === topic.name)
    if (!file) {
      console.log(`${topic.name}: no file in ${topic.team} — nothing was migrated here`)
      continue
    }
    const address = `30840:${t.pubkey}:${tag(file, 'd')}`
    // `#A`, not `#a`: a NIP-22 reply keeps the uppercase root tags and drops
    // the lowercase `a`, so the `#a` read `migrate` counts with would miss
    // every threaded copy this mode writes.
    const onFile = await query([{ kinds: [1111], '#A': [address], limit: 2000 }])
    const agentCopies = onFile.filter((e) => e.pubkey === t.pubkey && origOf(e) && !remigrated(e))
    const done = new Map(onFile.filter((e) => origOf(e) && remigrated(e)).map((e) => [origOf(e)!, e]))
    if (!agentCopies.length && !done.size) {
      console.log(`${topic.name}: no re-posted conversation on the file`)
      continue
    }
    // The originals the copies stand in for must be readable, or the run
    // would trade 134 good copies for nothing.
    const have = new Set(topic.messages.map((m) => m.id))
    const lost = agentCopies.filter((e) => !have.has(origOf(e)!)).length
    if (lost) {
      problems.push(
        `${topic.name}: ${lost} of ${agentCopies.length} original(s) unreadable — channel ${topic.uuid} is ${topic.live ? 'live but no longer holds them' : 'still deleted (clear channels.deleted_at)'}`,
      )
    }
    for (const pk of new Set(topic.messages.map((m) => m.pubkey))) {
      if (pk !== t.pubkey && !keys.has(pk)) problems.push(`${topic.name}: no key for author ${pk}`)
    }
    jobs.push({ topic, address, agentCopies, done })
    console.log(
      `${topic.name}: ${topic.messages.length} original(s), ${agentCopies.length} agent copy/copies to replace` +
        `${done.size ? `, ${done.size} already re-posted` : ''}`,
    )
  }

  if (problems.length) {
    console.log(`\nnothing written — ${problems.length} problem(s):`)
    for (const line of [...new Set(problems)]) console.log(`    ${line}`)
    // The authors are knowable even while the originals are not: `migrate`
    // put each one's pubkey in the copy's `orig` tag. So one trip to the box
    // can clear `deleted_at` and export exactly these keys, rather than two.
    const authors = [...new Set(jobs.flatMap((j) => j.agentCopies.map((e) => e.tags.find((x) => x[0] === 'orig')?.[3]).filter((x): x is string => !!x)))]
    if (authors.length) {
      const named = await createPeopleCache().viaRelay(query)(authors)
      console.log(`\nthe keys this run needs, read off the copies' orig tags:`)
      for (const pk of authors) {
        const label = pk === t.pubkey ? 'signs itself through /sign' : keys.has(pk) ? 'key present' : 'KEY MISSING'
        console.log(`    ${pk}  ${named[pk]?.displayName ?? '?'} — ${label}`)
      }
    }
    throw new Error('remigrate refused to start')
  }
  const writes = jobs.reduce((n, j) => n + j.topic.messages.length - j.done.size + j.agentCopies.length, 0)
  console.log(`\n${jobs.length} file(s), ${writes} write(s), about ${Math.ceil((writes * WRITE_GAP_MS) / 60_000)} min\n`)

  const signerFor = (pubkey: string) => (pubkey === t.pubkey ? t : keySigner(keys.get(pubkey)!))
  /** True until the relay refuses a back-dated `created_at`; see the note above. */
  let backdate = true

  for (const job of jobs) {
    const { topic, address } = job
    const team = TEAMS[topic.team]!
    const map = new Map([...job.done].map(([orig, e]) => [orig, { id: e.id, pubkey: e.pubkey }]))
    let posted = 0
    let failed = 0
    for (const m of topic.messages) {
      if (map.has(m.id)) continue
      const parent = parentOf(m)
      const to = parent ? map.get(parent) : undefined
      const build = (withTrueTime: boolean): UnsignedEvent => ({
        pubkey: m.pubkey,
        created_at: withTrueTime ? m.created_at : toNostrSeconds(Date.now()),
        kind: 1111,
        tags: [
          ['A', address],
          ['K', '30840'],
          ['P', t.pubkey],
          // A reply names its parent's copy and nothing else; a top-level
          // message repeats the root. NIP-22 §6.4.
          ...(to ? [['e', to.id], ['k', '1111'], ['p', to.pubkey]] : [['a', address], ['k', '30840'], ['p', t.pubkey]]),
          ['h', team],
          ...m.tags.filter((x) => x[0] === 'imeta'),
          ['orig', m.id, String(m.created_at), m.pubkey],
          ['migration', MARK],
        ],
        content: withTrueTime || !dateLine ? m.content : `*${stamp(m.created_at)}*\n\n${m.content}`,
      })
      let r = await publish(build(backdate), signerFor(m.pubkey))
      if (!r.ok && backdate) {
        console.log(`    back-dating refused (${r.status} ${r.reason}) — the run stamps now and states the true time instead`)
        backdate = false
        await sleep(WRITE_GAP_MS)
        r = await publish(build(false), signerFor(m.pubkey))
      }
      if (!r.ok) {
        console.log(`    ${m.id.slice(0, 8)} by ${m.pubkey.slice(0, 8)} → REFUSED ${r.reason}`)
        failed++
        await sleep(WRITE_GAP_MS)
        continue
      }
      map.set(m.id, { id: r.id, pubkey: m.pubkey })
      posted++
      await sleep(WRITE_GAP_MS)
    }
    if (failed) {
      console.log(`${topic.name}: re-posted ${posted}, ${failed} refused — the agent's copies are kept, nothing is lost`)
      continue
    }
    let removed = 0
    for (const e of job.agentCopies) {
      const r = await publish(buildDeletion(t.pubkey, Date.now(), { targetEventId: e.id }), t)
      if (r.ok) removed++
      else console.log(`    kind:5 ${e.id.slice(0, 8)} → REFUSED ${r.reason}`)
      await sleep(WRITE_GAP_MS)
    }
    const after = await query([{ kinds: [1111], '#A': [address], limit: 2000 }])
    const left = after.filter((x) => x.pubkey === t.pubkey && origOf(x)).length
    console.log(
      `${topic.name}: re-posted ${posted}, took back ${removed}/${job.agentCopies.length}; ` +
        `file now holds ${after.filter((x) => origOf(x)).length} copy/copies, ${left} still the agent's`,
    )
  }
  console.log(`\ncreated_at: ${backdate ? 'the originals kept their true time' : 'stamped at run time (the 960 s commit floor)'}`)
}

/**
 * The done-when, read off production — no writes, so it runs without keys.
 *
 * Counts only mean anything while the topic channels are readable, so run this
 * **before** re-deleting them; afterwards it can still say that no agent copy
 * is left, but not that the copies match the originals.
 */
async function verify(p: { folders: FolderSummary[]; topics: Topic[] }, query: QueryFn, t: Signer) {
  let failures = 0
  for (const topic of p.topics) {
    if (topic.fate === 'delete' || topic.fate === 'ask') continue
    const file = (await query([{ kinds: [30840], '#h': [TEAMS[topic.team]!], authors: [t.pubkey], limit: 200 }])).find((e) => tag(e, 'title') === topic.name)
    if (!file) {
      // `unmigrate` took the file *and* its copies back down wherever the
      // channel turned out to be a record Folder, so no file there is the
      // settled outcome rather than a gap — never keep both.
      const settled = topic.live
      if (!settled) failures++
      console.log(`${settled ? '·' : '✗'} ${topic.name}: no file in ${topic.team}${settled ? ' — still a channel, taken back by unmigrate' : ''}`)
      continue
    }
    const address = `30840:${t.pubkey}:${tag(file, 'd')}`
    const onFile = await query([{ kinds: [1111], '#A': [address], limit: 2000 }])
    // A finished file holds only marked copies. `migrate`'s stand-ins are the
    // unmarked ones — including, once the agent signs its own messages, ones
    // with the same author as a correct copy.
    const copies = new Map(onFile.filter((e) => origOf(e) && remigrated(e)).map((e) => [origOf(e)!, e]))
    const stale = onFile.filter((e) => origOf(e) && !remigrated(e)).length
    const mine = [...copies.values()].filter((e) => e.pubkey === t.pubkey).length
    const readable = topic.live || topic.messages.length > 0

    let threaded = 0
    let wrong = 0
    for (const m of topic.messages) {
      const parent = parentOf(m)
      if (!parent) continue
      const copy = copies.get(m.id)
      const parentCopy = copies.get(parent)
      if (!copy || !parentCopy) continue
      threaded++
      if (copy.tags.find((x) => x[0] === 'e')?.[1] !== parentCopy.id) wrong++
    }
    // Counts only prove anything while the channel is readable; with it
    // deleted again the one clause still checkable is that no stand-in is
    // left. Say which of the two was measured rather than passing on silence.
    const ok = stale === 0 && (!readable || (copies.size === topic.messages.length && wrong === 0))
    if (!ok) failures++
    console.log(
      `${ok ? '✓' : '✗'} ${topic.name}: ${readable ? `${topic.messages.length} original(s)` : 'originals unreadable (counts unchecked)'}` +
        ` vs ${copies.size} re-posted (${copies.size - mine} by a person, ${mine} the agent's own)` +
        `, ${stale} stand-in(s) left; ${threaded} reply/replies checked, ${wrong} mis-parented`,
    )
  }
  console.log(`\n${failures ? `${failures} file(s) not done` : 'every file checked out'}`)
}

async function main() {
  const mode = process.argv[2]
  const modes = ['survey', 'migrate', 'unmigrate', 'remigrate', 'verify']
  if (mode === 'delete') throw new Error('delete moved to scripts/fol25-redelete.ts, which reads no Convex and never empties a channel to delete it')
  if (!modes.includes(mode ?? '')) throw new Error(`mode: ${modes.join(' | ')}`)
  const agent = agentSigner(await token())
  const query = queryFn(agent)
  console.log(`identity ${agent.pubkey.slice(0, 8)}… relay ${RELAY_URL} mode ${mode}\n`)
  const p = await plan(query)
  if (mode === 'survey') await survey(p, query)
  if (mode === 'migrate') await migrate(p, query, agent)
  if (mode === 'unmigrate') await unmigrate(p, query, agent)
  if (mode === 'remigrate') await remigrate(p, query, agent)
  if (mode === 'verify') await verify(p, query, agent)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
