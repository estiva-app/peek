/**
 * SHR-8: publish the messages that exist only in Convex, with their real dates.
 *
 *   cd ~/peek-shr8-work && set -a && . ~/.estiva-agent.env && set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/shr8-migrate.ts plan
 *   npx tsx --tsconfig tsconfig.app.json scripts/shr8-migrate.ts rehearse [days]
 *   npx tsx --tsconfig tsconfig.app.json scripts/shr8-migrate.ts migrate --keys ~/.fol25-keys.json
 *   npx tsx --tsconfig tsconfig.app.json scripts/shr8-migrate.ts writeback
 *   npx tsx --tsconfig tsconfig.app.json scripts/shr8-migrate.ts verify
 *   npx tsx --tsconfig tsconfig.app.json scripts/shr8-migrate.ts cleanup <channel uuid>
 *
 * `plan` and `verify` are read-only and need nothing but the agent credential.
 * `rehearse` and `migrate` write to production. `writeback` needs Convex admin
 * and is the one step this machine cannot run — see {@link writeback}.
 *
 * ## What it migrates, and where to
 *
 * The population is the census's gap minus CON-4's discard: the rows whose
 * `nostrEventId` is null, in the ten topics that have a `30840` file. Each one
 * lands as a `kind:1111` on that file — Miky's decision of 2026-09-22, for the
 * reasons in the project brief: it is what FOL-14, FOL-25 and FOL-37 already
 * do, the old channels are scheduled for deletion, and a `1111` on a file
 * carries `h = <team channel>` so a soft-deleted topic channel cannot swallow
 * it.
 *
 * Two topics are deliberately **not** here — *Feedback on Peek* (33) and
 * *Claude on Estiva* (1). Their channels are live, staying, and hold Ship
 * issues by `h`; whether their content is reachable at all is CON-12's
 * measurement, and until it answers, a shape chosen here would be a guess.
 * `con4-discarded.ts` `NO_FILE_TARGET` is the authority, and this script reads
 * it rather than restating it. *For testing* is discarded there too.
 *
 * ## Why `plan` exists as its own mode
 *
 * Three things decide the run and none of them can be read off the code:
 *
 *  1. **Whose keys it needs.** An author is a signature. The census names
 *     *Miky* and *Katerina*; this prints the pubkeys, and the run refuses to
 *     start if one is missing rather than signing 122 of 179 and stopping.
 *  2. **What a reply hangs off.** A Convex reply is flat under its root, but
 *     that root may itself be in the gap, may already have a `1111` copy on
 *     the file (FOL-25's `remigrate`), or may be published *only* as a
 *     `kind:9` in the topic channel — which is CON-12's 481. Only the first
 *     two can be threaded onto the file, and the third is a gate, not a
 *     detail: 141 of the 185 nulls are replies.
 *  3. **What carries an attachment.** Those blobs are in Convex storage and
 *     CON-5 has not moved them. Publishing such a message without its `imeta`
 *     would take the census's attachment line down without a byte having
 *     moved — the exact silent improvement this project exists to stop.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor, publicKeyFromSecret, signEvent, toNostrSeconds } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { readFileSync } from 'node:fs'
import { DISCARDED, NO_FILE_TARGET, TEAMS } from './con4-discarded.js'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const CONVEX = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'

/** Between writes: the relay's quota trips after a handful in a row (FOL-25). */
const WRITE_GAP_MS = 6_000

/** What a copy written by this run is marked with, so a re-run skips it. */
const MARK = 'shr8-migrate'

type Token = { accessToken: string; pubkey: string }
type Signer = { pubkey: string; sign: (u: UnsignedEvent) => Promise<SignedEvent> }

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

async function signVia(unsigned: UnsignedEvent, t: Token, retried = false): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t.accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (res.status === 401 && !retried && t.accessToken) {
    // Only the agent's own token can be renewed from here; a person's token is
    // an hour long and comes from their tab, so this re-mints nothing for them.
    if (CLIENT_ID && t.pubkey === (await token()).pubkey) {
      t.accessToken = (await token()).accessToken
      return signVia(unsigned, t, true)
    }
  }
  if (!res.ok) throw new Error(`POST /sign: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { event: SignedEvent }).event
}

const tokenSigner = (t: Token): Signer => ({ pubkey: t.pubkey, sign: (u) => signVia(u, t) })
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

function queryFn(s: Signer) {
  return async (filters: Record<string, unknown>[]): Promise<SignedEvent[]> => {
    const { status, text } = await bridge('/query', filters, s)
    if (status !== 200) throw new Error(`POST /query: ${status} ${text.slice(0, 200)}`)
    return JSON.parse(text) as SignedEvent[]
  }
}

/** Publish one event; the relay refuses as `200` with `accepted: false`. */
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
  return { ok, status, reason: ok ? undefined : (parsed.reason ?? parsed.message ?? `${status} ${text.slice(0, 160)}`), id: signed.id }
}

async function convex<T>(path: string, args: Record<string, unknown>, accessToken?: string): Promise<T> {
  const res = await fetch(`${CONVEX}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const body = (await res.json()) as { status?: string; value?: unknown; errorMessage?: string }
  if (body.status === 'error') throw new Error(`${path}: ${body.errorMessage}`)
  return (body.value ?? body) as T
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tag = (e: SignedEvent, name: string) => e.tags.find((x) => x[0] === name)?.[1]
const short = (s: string) => s.slice(0, 8)
const stamp = (secs: number) => new Date(secs * 1000).toISOString().slice(0, 16).replace('T', ' ')

/** The `orig` this run writes: the Convex row it stands for, its true time, its author. */
const origOf = (e: SignedEvent) => e.tags.find((x) => x[0] === 'orig')?.[1]
const migrated = (e: SignedEvent) => e.tags.some((x) => x[0] === 'migration' && x[1] === MARK)

// ── Reading the two stores ──────────────────────────────────────────────────

interface Row {
  id: string
  authorId?: string
  authorName?: string
  createdAt: number
  body?: string
  files?: unknown[]
  nostrEventId?: string | null
}

/** One Convex message or reply, flattened — the unit the census counts. */
interface Item {
  surface: string
  kind: 'root' | 'reply'
  /** The Convex row id, as the public queries spell it (`seedKey ?? _id`). */
  id: string
  /** For a reply, the root's Convex row id. A Convex thread is flat. */
  rootId?: string
  createdAt: number
  authorId?: string
  authorName: string
  pubkey?: string
  body: string
  attachments: number
  eventId: string | null
}

interface Surface {
  title: string
  topicId: string
  channelUuid: string | null
  team?: keyof typeof TEAMS
  /** The `30840` this topic's conversation migrates onto. */
  file?: SignedEvent
  address?: string
  items: Item[]
  /** Copies already on the file, by the `orig` they stand for. */
  done: Map<string, SignedEvent>
  discarded?: string
  noFileTarget?: string
}

async function collect(title: string, topicId: string): Promise<Item[]> {
  const items: Item[] = []
  const page = await convex<{ rows: Row[] }>('messages:list', { parentKind: 'topic', parentKey: topicId })
  for (const m of page.rows) {
    items.push({
      surface: title,
      kind: 'root',
      id: m.id,
      createdAt: m.createdAt,
      authorId: m.authorId,
      authorName: m.authorName ?? '?',
      body: String(m.body ?? ''),
      attachments: m.files?.length ?? 0,
      eventId: m.nostrEventId ?? null,
    })
    const replies = await convex<Row[]>('replies:list', { messageKey: m.id })
    for (const r of replies) {
      items.push({
        surface: title,
        kind: 'reply',
        id: r.id,
        rootId: m.id,
        createdAt: r.createdAt,
        authorId: r.authorId,
        authorName: r.authorName ?? '?',
        body: String(r.body ?? ''),
        attachments: r.files?.length ?? 0,
        eventId: r.nostrEventId ?? null,
      })
    }
  }
  return items
}

/**
 * Everything on a file's conversation, read the way the product reads it.
 *
 * **Two reads, because that is what Peek does.** Interop asks for the roots by
 * lowercase `#a` (`projection.js` — `'#a': [file.address]`), and Peek then
 * asks for the replies by `#e` on those root ids (`src/nostr/foreign.ts:792`).
 * A NIP-22 reply carries no lowercase `a` at all, so one `#a` read returns
 * roots only and a reader that stopped there would report a thread as absent.
 *
 * **Not `#A`.** The uppercase read looks like the tidier question and is what
 * `fol25-topics-to-files.ts` uses, but this relay does not answer it reliably:
 * measured 2026-09-22 against two files whose contents were confirmed present
 * by an `ids:` lookup, the same filter returned 78 events at `limit: 2000` and
 * **0** at `limit: 100`, and 0 at any limit for the other file. Whatever that
 * is, a done-when must not rest on it — and the product never asks it, so the
 * product's own shape is both safer and more honest.
 */
async function fileConversation(query: ReturnType<typeof queryFn>, address: string): Promise<SignedEvent[]> {
  const roots = await query([{ kinds: [1111], '#a': [address], limit: 2000 }])
  const out = new Map(roots.map((e) => [e.id, e]))
  for (let i = 0; i < roots.length; i += 100) {
    const ids = roots.slice(i, i + 100).map((e) => e.id)
    if (!ids.length) continue
    for (const e of await query([{ kinds: [1111], '#e': ids, limit: 2000 }])) out.set(e.id, e)
  }
  return [...out.values()]
}

/**
 * Every topic, with its file, its rows and what is already migrated onto it.
 *
 * The file is matched on the `30840`'s `title` tag against the Convex title
 * **verbatim**, which is the contract `con4-topic-files.ts` states and which
 * `probe-con16-channel-vs-file.ts` and `fol25-topics-to-files.ts` both rely on.
 */
async function survey(query: ReturnType<typeof queryFn>, agent: string): Promise<Surface[]> {
  const topics = await convex<Array<{ title: string; id: string; channelUuid: string | null }>>('topics:list', {})
  const filesByTeam = new Map<keyof typeof TEAMS, SignedEvent[]>()
  for (const [name, uuid] of Object.entries(TEAMS) as Array<[keyof typeof TEAMS, string]>) {
    filesByTeam.set(name, await query([{ kinds: [30840], '#h': [uuid], authors: [agent], limit: 500 }]))
  }

  const out: Surface[] = []
  for (const t of topics) {
    const s: Surface = {
      title: t.title,
      topicId: t.id,
      channelUuid: t.channelUuid,
      items: await collect(t.title, t.id),
      done: new Map(),
      discarded: DISCARDED[t.title],
      noFileTarget: NO_FILE_TARGET[t.title],
    }
    if (!s.discarded && !s.noFileTarget) {
      for (const [team, files] of filesByTeam) {
        const file = files.find((e) => tag(e, 'title') === t.title)
        if (!file) continue
        s.team = team
        s.file = file
        s.address = `30840:${file.pubkey}:${tag(file, 'd')}`
        break
      }
      if (s.address) {
        for (const e of await fileConversation(query, s.address)) {
          const o = origOf(e)
          if (o) s.done.set(o, e)
        }
      }
    }
    out.push(s)
  }
  return out
}

/** Convex author id / name → the pubkey an event must be signed with. */
async function authorKeys(): Promise<{ byId: Map<string, string>; byName: Map<string, string> }> {
  const people = await convex<Array<{ id: string; name: string; pubkey?: string }>>('people:list', {})
  const mentions = await convex<Array<{ pubkey: string; name: string }>>('people:mentionNames', {})
  const byId = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const p of people) {
    if (!p.pubkey) continue
    byId.set(p.id, p.pubkey)
    byName.set(p.name, p.pubkey)
  }
  // `people:list` drops the viewer and every relay-only identity;
  // `mentionNames` drops neither, which is why both are read (convex/people.ts).
  for (const m of mentions) if (!byName.has(m.name)) byName.set(m.name, m.pubkey)
  return { byId, byName }
}

const pubkeyFor = (item: Item, keys: { byId: Map<string, string>; byName: Map<string, string> }) =>
  (item.authorId ? keys.byId.get(item.authorId) : undefined) ?? keys.byName.get(item.authorName)

// ── plan ────────────────────────────────────────────────────────────────────

/** What a migrated reply can hang off, once its root is accounted for. */
type Anchor =
  | { kind: 'in-run'; rootId: string }
  | { kind: 'on-file'; eventId: string; pubkey: string }
  | { kind: 'channel-only'; eventId: string }
  | { kind: 'unreachable' }

function anchorFor(item: Item, s: Surface, gap: Set<string>, onRelay: Map<string, SignedEvent>): Anchor {
  if (item.kind === 'root') return { kind: 'unreachable' }
  const rootId = item.rootId!
  if (gap.has(rootId)) return { kind: 'in-run', rootId }
  const copy = s.done.get(rootId)
  if (copy) return { kind: 'on-file', eventId: copy.id, pubkey: copy.pubkey }
  const root = s.items.find((x) => x.id === rootId)
  if (root?.eventId && onRelay.has(root.eventId)) return { kind: 'channel-only', eventId: root.eventId }
  return { kind: 'unreachable' }
}

async function plan(query: ReturnType<typeof queryFn>, agent: string) {
  const surfaces = await survey(query, agent)
  const keys = await authorKeys()

  // A root that is published lives as a kind:9 in the topic channel; whether it
  // is *readable* is a separate question from whether a column names it, and
  // PEE-30 is the reason to ask the relay rather than trust the column.
  const publishedIds = surfaces.flatMap((s) => s.items.map((i) => i.eventId).filter((x): x is string => !!x))
  const onRelay = new Map<string, SignedEvent>()
  for (let i = 0; i < publishedIds.length; i += 100) {
    const batch = publishedIds.slice(i, i + 100)
    for (const e of await query([{ ids: batch, limit: batch.length }])) onRelay.set(e.id, e)
  }

  console.log(`Convex: ${surfaces.length} topics. Relay: ${RELAY_URL}\n`)
  const header = 'surface'.padEnd(46) + 'gap'.padStart(5) + 'roots'.padStart(7) + 'replies'.padStart(9) + 'done'.padStart(6) + 'attach'.padStart(8) + '  anchors'
  console.log(header)

  let total = 0
  let writable = 0
  const missingKeys = new Set<string>()
  const unanchored: Item[] = []
  const attachmentHeld: Item[] = []
  const authorTally = new Map<string, number>()

  for (const s of surfaces) {
    const gapItems = s.items.filter((i) => !i.eventId)
    if (!gapItems.length && !s.done.size) continue
    if (s.discarded) {
      console.log(`${('topic/' + s.title).slice(0, 44).padEnd(46)}${String(gapItems.length).padStart(5)}${''.padStart(7)}${''.padStart(9)}${''.padStart(6)}${''.padStart(8)}  DISCARDED (CON-4)`)
      continue
    }
    if (s.noFileTarget) {
      console.log(`${('topic/' + s.title).slice(0, 44).padEnd(46)}${String(gapItems.length).padStart(5)}${''.padStart(7)}${''.padStart(9)}${''.padStart(6)}${''.padStart(8)}  held for CON-12`)
      continue
    }
    if (!s.address) {
      console.log(`${('topic/' + s.title).slice(0, 44).padEnd(46)}${String(gapItems.length).padStart(5)}  NO FILE — CON-4 missed it`)
      continue
    }

    const gap = new Set(gapItems.map((i) => i.id))
    const roots = gapItems.filter((i) => i.kind === 'root')
    const replies = gapItems.filter((i) => i.kind === 'reply')
    const anchors = { 'in-run': 0, 'on-file': 0, 'channel-only': 0, unreachable: 0 }
    for (const r of replies) {
      const a = anchorFor(r, s, gap, onRelay)
      anchors[a.kind]++
      if (a.kind === 'channel-only' || a.kind === 'unreachable') unanchored.push(r)
    }
    for (const i of gapItems) {
      total++
      const pk = pubkeyFor(i, keys)
      if (!pk) missingKeys.add(`${i.authorName} (authorId ${i.authorId ?? '?'})`)
      else authorTally.set(pk, (authorTally.get(pk) ?? 0) + 1)
      if (i.attachments > 0) attachmentHeld.push(i)
      if (s.done.has(i.id)) continue
      writable++
    }
    const desc = Object.entries(anchors).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ')
    console.log(
      ('topic/' + s.title).slice(0, 44).padEnd(46) +
        String(gapItems.length).padStart(5) +
        String(roots.length).padStart(7) +
        String(replies.length).padStart(9) +
        String(s.done.size).padStart(6) +
        String(gapItems.reduce((n, i) => n + i.attachments, 0)).padStart(8) +
        (desc ? `  ${desc}` : ''),
    )
  }

  console.log(`\n— the run ———————————————————————————————`)
  console.log(`rows in scope (file targets only):  ${total}`)
  console.log(`already migrated by an earlier run: ${total - writable}`)
  console.log(`to write:                           ${writable}  (~${Math.ceil((writable * WRITE_GAP_MS) / 60_000)} min at ${WRITE_GAP_MS / 1000}s between writes)`)

  console.log(`\nauthors, and so the signers this needs:`)
  const named = new Map([...keys.byName].map(([n, p]) => [p, n]))
  for (const [pk, n] of [...authorTally].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(4)}  ${pk}  ${named.get(pk) ?? '?'}${pk === agent ? '  — signs itself through /sign' : ''}`)
  }
  if (missingKeys.size) {
    console.log(`\n!! no pubkey for ${missingKeys.size} author(s) — the run cannot sign for them:`)
    for (const a of missingKeys) console.log(`   ${a}`)
  }

  if (unanchored.length) {
    console.log(`\n!! ${unanchored.length} repl(ies) whose root is not on the file — threading has nowhere to point:`)
    const bySurface = new Map<string, number>()
    for (const u of unanchored) bySurface.set(u.surface, (bySurface.get(u.surface) ?? 0) + 1)
    for (const [surface, n] of bySurface) console.log(`   ${n.toString().padStart(4)}  ${surface}`)
    console.log(`   Their roots are published as kind:9 in the topic channel and have no 1111 copy.`)
    console.log(`   That is CON-12's 481: until the root is copied onto the file, its replies`)
    console.log(`   can only be published top-level, which loses the thread the done-when names.`)
  }

  if (attachmentHeld.length) {
    const blobs = attachmentHeld.reduce((n, i) => n + i.attachments, 0)
    console.log(`\n${attachmentHeld.length} row(s) in scope carry ${blobs} attachment(s) whose bytes are still in Convex storage.`)
    console.log(`   They are migrated anyway: the message text is what this ticket owes, and holding`)
    console.log(`   them back would leave ${attachmentHeld.length} rows in the gap for a reason CON-5 owns. The census`)
    console.log(`   counts an attachment as migrated only when an \`imeta\` on the event describes it`)
    console.log(`   (probe-shr8-census.ts \`attachDescribed\`), so its attachment line does not improve`)
    console.log(`   by a byte here — CON-5's 62 stays 62 until the blobs move.`)
  }

  const oldest = surfaces
    .filter((s) => s.address)
    .flatMap((s) => s.items.filter((i) => !i.eventId))
    .reduce((m, i) => Math.min(m, i.createdAt), Date.now())
  console.log(`\noldest row in scope: ${stamp(Math.floor(oldest / 1000))} UTC — ${Math.ceil((Date.now() - oldest) / 86_400_000)} days.`)
  console.log(`So BUZZ_CREATED_AT_FLOOR_SECS must be at least ${Math.ceil((Date.now() - oldest) / 1000)} for the run to keep its dates.`)
}

// ── the pre-flight, which is also the rehearsal ─────────────────────────────

/**
 * Prove the exact shape the run writes, on objects the run mints itself.
 *
 * A back-dated `1111` on a `30840`, and a second one threaded under it, in a
 * throwaway channel that is hidden with a `9008` on the way out. Never an
 * existing object: a control is only a control if it is harmless when the code
 * under test is wrong (the Peek-team-Folder incident, 2026-09-15).
 *
 * It is the pre-flight because the two gates that refuse a back-dated event
 * fail in ways that are indistinguishable from each other at the call site —
 * a bare **500** is migration 0021's commit floor, a **400** is
 * `BUZZ_MAX_TIMESTAMP_DRIFT_SECS` — and because the floor aborts at COMMIT,
 * so "accepted" is a claim about a transaction that had not finished. Both
 * legs are therefore read back by id before anything real is written.
 *
 * `fresh` is the soundness control: if a *current* event is refused, the probe
 * is broken and nothing may be concluded about the window from the other legs.
 */
async function preflight(agent: Signer, query: ReturnType<typeof queryFn>, ageSecs: number): Promise<boolean> {
  const { randomUUID } = await import('node:crypto')
  const { buildCreateChannel, buildBareFile } = await import('@estiva-app/protocol')
  const channelUuid = randomUUID()
  const fileId = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  let ok = true
  const step = (what: string, good: boolean, detail = '') => {
    if (!good) ok = false
    console.log(`  ${good ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`)
  }

  const age = ageSecs >= 86_400 ? `${Math.round(ageSecs / 86_400)} days` : `${ageSecs}s`
  console.log(`pre-flight: a back-dated 1111 on a file, ${age} old, in a throwaway channel`)
  const channel = await publish(buildCreateChannel(agent.pubkey, Date.now(), { channelUuid, name: `shr8 pre-flight ${channelUuid.slice(0, 8)}`, visibility: 'private' }), agent)
  step(`throwaway channel ${short(channelUuid)}`, channel.ok, channel.ok ? '' : `${channel.status} ${channel.reason}`)
  if (!channel.ok) return false
  await sleep(WRITE_GAP_MS)

  const file = await publish(buildBareFile(agent.pubkey, Date.now(), { fileId, title: `shr8 pre-flight ${short(fileId)}`, channelUuid }), agent)
  step(`throwaway 30840 ${short(fileId)}`, file.ok, file.ok ? '' : `${file.status} ${file.reason}`)
  const address = `30840:${agent.pubkey}:${fileId}`
  await sleep(WRITE_GAP_MS)

  const comment = (created_at: number, parent?: { id: string; pubkey: string }): UnsignedEvent => ({
    pubkey: agent.pubkey,
    created_at,
    kind: 1111,
    tags: [
      ['A', address],
      ['K', '30840'],
      ['P', agent.pubkey],
      ...(parent ? [['e', parent.id], ['k', '1111'], ['p', parent.pubkey]] : [['a', address], ['k', '30840'], ['p', agent.pubkey]]),
      ['h', channelUuid],
    ],
    content: parent ? 'shr8 pre-flight reply' : 'shr8 pre-flight root',
  })

  const fresh = await publish(comment(now), agent)
  step('fresh 1111 accepted (soundness control)', fresh.ok, fresh.ok ? '' : `${fresh.status} ${fresh.reason}`)
  await sleep(WRITE_GAP_MS)

  const root = await publish(comment(now - ageSecs), agent)
  step(`back-dated root accepted`, root.ok, root.ok ? '' : `${root.status} ${root.reason} — ${root.status === 400 ? 'BUZZ_MAX_TIMESTAMP_DRIFT_SECS, the ingest drift gate' : 'a bare 500 is migration 0021, the commit floor'}`)
  await sleep(WRITE_GAP_MS)

  let readBack: SignedEvent[] = []
  if (root.ok) {
    const reply = await publish(comment(now - ageSecs + 60, { id: root.id, pubkey: agent.pubkey }), agent)
    step('back-dated reply accepted', reply.ok, reply.ok ? '' : `${reply.status} ${reply.reason}`)
    await sleep(WRITE_GAP_MS)
    readBack = await query([{ ids: [root.id, reply.id], limit: 2 }])
    const gotRoot = readBack.find((e) => e.id === root.id)
    const gotReply = readBack.find((e) => e.id === reply.id)
    // The floor aborts at COMMIT, so only a read proves the row survived.
    step('both survived the commit', readBack.length === 2, `relay returned ${readBack.length}/2`)
    step('the root kept its true created_at', gotRoot?.created_at === now - ageSecs, gotRoot ? `${stamp(gotRoot.created_at)} UTC` : 'not readable')
    step('the reply hangs off the root', gotReply?.tags.some((x) => x[0] === 'e' && x[1] === root.id) === true)
  }

  // A `9008` is refused while the channel still holds a file — "a delete would
  // hide them all; remove them first" — so the throwaway comes down in the
  // order it went up: comments, then the file, then the channel.
  const cleaned = await teardown(agent, query, channelUuid)
  step('throwaway taken down', cleaned, cleaned ? '' : `run: scripts/shr8-migrate.ts cleanup ${channelUuid}`)
  return ok
}

/**
 * Take a throwaway channel down completely: its comments, its file, then it.
 *
 * Separate from {@link preflight} because a run that dies mid-flight leaves the
 * channel behind, and the tidy-up must not need the ids the dead run held.
 * Everything here is read back off the relay by `#h`.
 */
async function teardown(agent: Signer, query: ReturnType<typeof queryFn>, channelUuid: string): Promise<boolean> {
  const { buildDeleteChannel, buildDeletion } = await import('@estiva-app/protocol')
  let ok = true
  const held = await query([{ '#h': [channelUuid], kinds: [1111, 30840], authors: [agent.pubkey], limit: 500 }])
  // Comments first: a file with comments on it is still a file the guard counts.
  for (const e of [...held.filter((x) => x.kind === 1111), ...held.filter((x) => x.kind === 30840)]) {
    const r = await publish(buildDeletion(agent.pubkey, Date.now(), { targetEventId: e.id }), agent)
    if (!r.ok) {
      ok = false
      console.log(`    kind:5 ${short(e.id)} (kind ${e.kind}) → REFUSED ${r.status} ${r.reason}`)
    }
    await sleep(WRITE_GAP_MS)
  }
  const hidden = await publish(buildDeleteChannel(agent.pubkey, Date.now(), { channelUuid }), agent)
  if (!hidden.ok) {
    ok = false
    console.log(`    9008 ${short(channelUuid)} → REFUSED ${hidden.status} ${hidden.reason}`)
  }
  return ok
}

// ── migrate ────────────────────────────────────────────────────────────────

/**
 * Who signs for whom, and who can write the result back into Convex.
 *
 * Two sources, and they are not equivalent:
 *
 *  - `--as <file>` — `[{"pubkey": …, "accessToken": …}, …]`, each copied from
 *    that person's signed-in Peek tab (`sessionStorage["peek.estivaId.token"]`).
 *    `/sign` signs as whoever the token belongs to, and the **same token
 *    authenticates Convex as that person**, which is the only way the
 *    write-back can run: `recordMessagePublished` is viewer-gated on
 *    `me === m.authorId` and returns *silently* for anyone else. No secret key
 *    exists anywhere in this route. Tokens last an hour; the run is resumable.
 *  - `--keys <file>` — `{"<pubkey>": "<secret>"}` as FOL-25's `remigrate` took
 *    them. Signs, but authenticates nothing, so every write-back has to be run
 *    afterwards by somebody with Convex admin. The run prints that list.
 */
function loadSigners(): { signers: Map<string, Signer>; tokens: Map<string, string> } {
  const signers = new Map<string, Signer>()
  const tokens = new Map<string, string>()
  const asIdx = process.argv.indexOf('--as')
  const keysIdx = process.argv.indexOf('--keys')
  if (asIdx > 0) {
    const raw = JSON.parse(readFileSync(process.argv[asIdx + 1]!, 'utf8')) as Token[] | Token
    for (const t of Array.isArray(raw) ? raw : [raw]) {
      signers.set(t.pubkey, tokenSigner({ pubkey: t.pubkey, accessToken: t.accessToken }))
      tokens.set(t.pubkey, t.accessToken)
    }
  }
  if (keysIdx > 0) {
    const raw = JSON.parse(readFileSync(process.argv[keysIdx + 1]!, 'utf8')) as Record<string, string>
    for (const [pubkey, secret] of Object.entries(raw)) {
      // Checked against the pubkey it is filed under before anything is
      // written: a mis-pasted key otherwise surfaces as a relay refusal with
      // nothing to connect it to the line that caused it.
      const derived = publicKeyFromSecret(secret)
      if (derived !== pubkey) throw new Error(`--keys: the key filed under ${short(pubkey)}… derives ${short(derived)}…`)
      if (!signers.has(pubkey)) signers.set(pubkey, keySigner(secret))
    }
  }
  return { signers, tokens }
}

/** Write the accepted event id onto the Convex row, and read it back. */
async function writeBack(item: Item, eventId: string, accessToken: string): Promise<string | null> {
  const path = item.kind === 'root' ? 'nostr/outbox:recordMessagePublished' : 'nostr/outbox:recordReplyPublished'
  const args = item.kind === 'root' ? { messageId: item.id, nostrEventId: eventId } : { replyId: item.id, nostrEventId: eventId }
  const res = await fetch(`${CONVEX}/api/mutation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ path, args, format: 'json' }),
  })
  const body = (await res.json()) as { status?: string; errorMessage?: string }
  if (body.status === 'error') return `${path}: ${body.errorMessage}`
  // The mutation is viewer-gated and returns *silently* when the caller is not
  // the author, so its success says nothing. The row is the evidence.
  return null
}

async function migrate(agent: Signer, query: ReturnType<typeof queryFn>) {
  const surfaces = await survey(query, agent.pubkey)
  const keys = await authorKeys()
  const { signers, tokens } = loadSigners()

  type Job = { surface: Surface; roots: Item[]; replies: Item[] }
  const jobs: Job[] = []
  const problems: string[] = []
  let oldest = Date.now()

  for (const s of surfaces) {
    if (s.discarded || s.noFileTarget || !s.address) continue
    const gapItems = s.items.filter((i) => !i.eventId && !s.done.has(i.id))
    if (!gapItems.length) continue
    const gap = new Set(s.items.filter((i) => !i.eventId).map((i) => i.id))
    for (const i of gapItems) {
      const pk = pubkeyFor(i, keys)
      if (!pk) problems.push(`${s.title}: no pubkey for author ${i.authorName}`)
      else if (!signers.has(pk)) problems.push(`${s.title}: no signer for ${short(pk)}… ${i.authorName}`)
      if (i.kind === 'reply') {
        const a = anchorFor(i, s, gap, new Map())
        if (a.kind !== 'in-run' && a.kind !== 'on-file') problems.push(`${s.title}: reply ${short(i.id)} has no parent on the file`)
      }
      oldest = Math.min(oldest, i.createdAt)
    }
    jobs.push({ surface: s, roots: gapItems.filter((i) => i.kind === 'root'), replies: gapItems.filter((i) => i.kind === 'reply') })
  }

  if (problems.length) {
    console.log(`nothing written — ${problems.length} problem(s):`)
    for (const line of [...new Set(problems)]) console.log(`    ${line}`)
    throw new Error('migrate refused to start')
  }
  const writes = jobs.reduce((n, j) => n + j.roots.length + j.replies.length, 0)
  if (!writes) {
    console.log('nothing to write — every row in scope already carries a copy on its file')
    return
  }
  console.log(`${jobs.length} file(s), ${writes} write(s), about ${Math.ceil((writes * WRITE_GAP_MS) / 60_000)} min\n`)

  // The window has to be open for the *oldest* row, not for a round number.
  const ageSecs = Math.ceil((Date.now() - oldest) / 1000) + 3600
  if (!(await preflight(agent, query, ageSecs))) {
    console.log(`\nnothing real was written. The back-dating window is not open for ${Math.ceil(ageSecs / 86_400)} days.`)
    console.log(`Open it as operations/PRODUCTION.md § Opening the back-dating window says, then re-run:`)
    console.log(`  BUZZ_MAX_TIMESTAMP_DRIFT_SECS=${ageSecs} and BUZZ_CREATED_AT_FLOOR_SECS=${ageSecs} in /opt/buzz/.env, then ./run.sh restart`)
    throw new Error('pre-flight failed')
  }
  console.log('')

  const pending: Array<{ item: Item; eventId: string }> = []
  for (const job of jobs) {
    const { surface: s } = job
    const team = TEAMS[s.team!]
    // orig (a Convex row id) → the copy that now stands for it.
    const map = new Map<string, { id: string; pubkey: string }>([...s.done].map(([orig, e]) => [orig, { id: e.id, pubkey: e.pubkey }]))
    let posted = 0
    let failed = 0

    // Roots first: an event id is the hash of its own content, so a reply's
    // `e` cannot name its root until the root exists.
    for (const item of [...job.roots, ...job.replies].sort((a, b) => (a.kind === b.kind ? a.createdAt - b.createdAt : a.kind === 'root' ? -1 : 1))) {
      const pk = pubkeyFor(item, keys)!
      const parent = item.kind === 'reply' ? map.get(item.rootId!) : undefined
      if (item.kind === 'reply' && !parent) {
        console.log(`    ${short(item.id)} — root not on the file after its pass; skipped`)
        failed++
        continue
      }
      const unsigned: UnsignedEvent = {
        pubkey: pk,
        created_at: toNostrSeconds(item.createdAt),
        kind: 1111,
        tags: [
          ['A', s.address!],
          ['K', '30840'],
          ['P', s.file!.pubkey],
          ...(parent ? [['e', parent.id], ['k', '1111'], ['p', parent.pubkey]] : [['a', s.address!], ['k', '30840'], ['p', s.file!.pubkey]]),
          ['h', team!],
          // The Convex row this stands for, its true time and its author — so
          // a re-run skips it and `verify` can match the two stores by id.
          ['orig', item.id, String(Math.floor(item.createdAt / 1000)), pk],
          ['migration', MARK],
        ],
        content: item.body,
      }
      const r = await publish(unsigned, signers.get(pk)!)
      if (!r.ok) {
        console.log(`    ${short(item.id)} by ${short(pk)} → REFUSED ${r.status} ${r.reason}`)
        failed++
        await sleep(WRITE_GAP_MS)
        continue
      }
      map.set(item.id, { id: r.id, pubkey: pk })
      posted++

      const accessToken = tokens.get(pk)
      if (accessToken) {
        const err = await writeBack(item, r.id, accessToken)
        if (err) console.log(`    ${short(item.id)} → published ${short(r.id)} but the write-back errored: ${err}`)
      }
      pending.push({ item, eventId: r.id })
      await sleep(WRITE_GAP_MS)
    }

    // The write-back mutation returns silently for a non-author, so the only
    // evidence is the column. Re-read the surface rather than trust the call.
    const after = await collect(s.title, s.topicId)
    const byId = new Map(after.map((i) => [i.id, i.eventId]))
    const wrote = pending.filter((p) => p.item.surface === s.title && byId.get(p.item.id) === p.eventId).length
    const mine = pending.filter((p) => p.item.surface === s.title).length
    console.log(`${s.title}: published ${posted}${failed ? `, ${failed} refused` : ''}; Convex now names ${wrote}/${mine}`)
  }

  const unwritten = []
  const after = new Map<string, string | null>()
  for (const s of new Set(pending.map((p) => p.item.surface))) {
    const surface = surfaces.find((x) => x.title === s)!
    for (const i of await collect(s, surface.topicId)) after.set(i.id, i.eventId)
  }
  for (const p of pending) if (after.get(p.item.id) !== p.eventId) unwritten.push(p)

  console.log(`\n— the run ———————————————————————————————`)
  console.log(`published: ${pending.length}`)
  console.log(`Convex rows updated: ${pending.length - unwritten.length}`)
  if (unwritten.length) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync('shr8-writeback.json', JSON.stringify(unwritten.map((p) => ({ kind: p.item.kind, id: p.item.id, nostrEventId: p.eventId })), null, 2))
    console.log(`\n!! ${unwritten.length} row(s) are on the relay but still read null in Convex, so the census`)
    console.log(`   cannot reach 0 and the two stores can no longer be matched. Written to`)
    console.log(`   shr8-writeback.json; somebody with Convex admin applies them in one command:`)
    console.log(`\n   npx tsx --tsconfig tsconfig.app.json scripts/shr8-migrate.ts writeback\n`)
    console.log(`   It re-reads every row afterwards and says how many columns actually moved.`)
  }
}

// ── writeback ──────────────────────────────────────────────────────────────

/**
 * Apply the write-backs the run could not, from somebody with Convex admin.
 *
 *   npx tsx --tsconfig tsconfig.app.json scripts/shr8-migrate.ts writeback
 *
 * Under the key-export route the run signs as the authors but authenticates
 * nothing, and `recordMessagePublished` is viewer-gated on `me ===
 * m.authorId`. So the column stays null, the census goes on reporting the row
 * as never published, and there is no way left to match it to its event — the
 * failure the ticket calls trap 1. The internal mutation has no viewer check
 * and is reachable from the CLI, which needs the account that owns
 * `honorable-guineapig-592`; this machine's `~/.convex/config.json` is an
 * anonymous local deployment, so this mode is the one part of SHR-8 that is
 * somebody else's paste.
 *
 * It re-reads every row afterwards. `npx convex run` exiting 0 says the call
 * was made, not that the column moved, and the whole point of the write-back
 * is the column.
 */
async function writeback() {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { mkdtempSync, rmSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const run = promisify(execFile)
  const path = process.argv[3] ?? 'shr8-writeback.json'
  const rows = JSON.parse(readFileSync(path, 'utf8')) as Array<{ kind: 'root' | 'reply'; id: string; nostrEventId: string }>
  console.log(`${rows.length} row(s) from ${path}\n`)

  /*
    Every id here is a **seedKey**, not a Convex id: the public queries return
    `seedKey ?? _id` (`convex/messages.ts` `shape`), and all 145 rows in the gap
    carry one — 28 `sent_…`, 117 `reply_…`, minted by the composer's optimistic
    send (`src/api/actions.ts:468`). Both mark mutations take `v.id('messages')`,
    which rejects a seedKey, and nothing in `convex/` maps one to its `_id`.

    So the map comes from a snapshot rather than from new Convex code — Convex
    is being retired, and a migration is the wrong moment to add to it. `export
    --path <dir>` writes `<table>/documents.jsonl` directly, so there is no
    archive to open. It needs the account that owns the deployment, which is
    also what the mutation needs, so it costs no extra credential.
  */
  /*
    `--deployment <name>`, not `--prod`. This worktree has no `.env.local` and
    the repo has no `convex.json`, so there is nothing for the CLI to resolve a
    *project* from and `--prod` fails with "No CONVEX_DEPLOYMENT set" before it
    reaches the network. A deployment name needs no project resolution, and the
    name is the first label of the URL every script here already points at.
  */
  const deployment = process.env.CONVEX_DEPLOYMENT_NAME ?? new URL(CONVEX).hostname.split('.')[0]!
  const dir = join(mkdtempSync(join(tmpdir(), 'shr8-')), 'snapshot')
  console.log(`deployment: ${deployment}`)
  console.log(`reading a snapshot for the seedKey → _id map (${dir}) …`)
  await run('npx', ['convex', 'export', '--deployment', deployment, '--path', dir], { maxBuffer: 1 << 28 })
  const idOf = new Map<string, string>()
  for (const table of ['messages', 'replies']) {
    const file = join(dir, table, 'documents.jsonl')
    if (!existsSync(file)) throw new Error(`${file} missing — the export has no ${table} table`)
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const doc = JSON.parse(line) as { _id: string; seedKey?: string }
      idOf.set(doc._id, doc._id)
      if (doc.seedKey) idOf.set(doc.seedKey, doc._id)
    }
  }
  // The snapshot is the whole database. It has done its job by here.
  rmSync(dir, { recursive: true, force: true })
  const unresolved = rows.filter((r) => !idOf.has(r.id))
  console.log(`map: ${idOf.size} key(s); unresolved: ${unresolved.length}\n`)
  if (unresolved.length) {
    for (const r of unresolved.slice(0, 5)) console.log(`  no _id for ${r.id}`)
    throw new Error('refusing to start: the snapshot does not name every row')
  }

  let called = 0
  for (const row of rows) {
    const fn = row.kind === 'root' ? 'nostr/data:markMessagePublished' : 'nostr/data:markReplyPublished'
    const arg = row.kind === 'root' ? 'messageId' : 'replyId'
    try {
      await run('npx', ['convex', 'run', '--deployment', deployment, fn, JSON.stringify({ [arg]: idOf.get(row.id), nostrEventId: row.nostrEventId })])
      called++
    } catch (e) {
      console.log(`  ${short(row.id)} → ${e instanceof Error ? e.message.split('\n')[0] : e}`)
    }
  }

  // The column is the evidence, not the exit code.
  const topics = await convex<Array<{ title: string; id: string }>>('topics:list', {})
  const seen = new Map<string, string | null>()
  for (const t of topics) for (const i of await collect(t.title, t.id)) seen.set(i.id, i.eventId)
  const landed = rows.filter((r) => seen.get(r.id) === r.nostrEventId).length
  console.log(`\ncalls that returned: ${called}/${rows.length}`)
  console.log(`rows whose column now names the event: ${landed}/${rows.length}`)
  process.exitCode = landed === rows.length ? 0 : 1
}

// ── readback ───────────────────────────────────────────────────────────────

/**
 * Ask the relay for the run's own event ids, one by one.
 *
 * `verify` reads each file by `#A` and counts what is on it. When that
 * disagrees with a run that reported 145 accepted and zero refusals, the two
 * candidate explanations need separating before anything is re-run: the event
 * is **not stored** (accepted at ingest, lost at COMMIT), or it is stored and
 * **not reachable by that filter**. An `ids:` lookup answers only the first,
 * which is what makes it the right question here.
 */
async function readback(query: ReturnType<typeof queryFn>) {
  const rows = JSON.parse(readFileSync(process.argv[3] ?? 'shr8-writeback.json', 'utf8')) as Array<{ kind: string; id: string; nostrEventId: string }>
  const found = new Map<string, SignedEvent>()
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50).map((r) => r.nostrEventId)
    for (const e of await query([{ ids: batch, limit: batch.length }])) found.set(e.id, e)
  }
  const missing = rows.filter((r) => !found.has(r.nostrEventId))
  console.log(`published ids: ${rows.length}`)
  console.log(`readable by id: ${found.size}`)
  console.log(`missing: ${missing.length}`)
  if (found.size) {
    const sample = [...found.values()].sort((a, b) => a.created_at - b.created_at)
    console.log(`\noldest readable: ${stamp(sample[0]!.created_at)} UTC`)
    console.log(`newest readable: ${stamp(sample[sample.length - 1]!.created_at)} UTC`)
  }
  // The discriminator: if what survived is exactly the recent end, the floor
  // took the rest at COMMIT and "accepted" never meant stored.
  const byAge = rows.map((r) => ({ r, e: found.get(r.nostrEventId) }))
  const oldestFound = byAge.filter((x) => x.e).reduce((m, x) => Math.min(m, x.e!.created_at), Infinity)
  console.log(`\nevery readable event is newer than ${stamp(oldestFound)} UTC`)
  process.exitCode = missing.length ? 1 : 0
}

// ── verify ─────────────────────────────────────────────────────────────────

/** The done-when, read off both stores. No writes, so it needs no signer. */
async function verify(query: ReturnType<typeof queryFn>, agent: string) {
  const surfaces = await survey(query, agent)
  let failures = 0
  let pendingWriteback = 0
  console.log('surface'.padEnd(46) + 'scope'.padStart(7) + 'copied'.padStart(8) + 'dated'.padStart(7) + 'threaded'.padStart(10) + '  in Convex')
  for (const s of surfaces) {
    if (s.discarded || s.noFileTarget || !s.address) continue
    // Scope is what *this run* owes: a row with no event, or one it copied.
    // Not `s.done`, which also holds FOL-25's `migrate` copies — those carry an
    // `orig` naming a Convex row that was published long ago, so counting them
    // marked nine surfaces incomplete for work that was never this ticket's.
    const copies = new Map([...s.done].filter(([, e]) => migrated(e)))
    const scope = s.items.filter((i) => !i.eventId || copies.has(i.id))
    if (!scope.length) continue
    let dated = 0
    let threaded = 0
    let named = 0
    for (const i of scope) {
      const copy = copies.get(i.id)
      if (!copy) continue
      if (copy.created_at === Math.floor(i.createdAt / 1000)) dated++
      if (i.kind === 'root') threaded++
      else {
        const parent = copies.get(i.rootId!) ?? s.done.get(i.rootId!)
        if (parent && copy.tags.some((x) => x[0] === 'e' && x[1] === parent.id)) threaded++
      }
      if (i.eventId === copy.id) named++
    }
    const onRelay = copies.size === scope.length && dated === scope.length && threaded === scope.length
    const ok = onRelay && named === scope.length
    if (!onRelay) failures++
    else if (!ok) pendingWriteback += scope.length - named
    console.log(
      `${ok ? ' ' : '✗'}${('topic/' + s.title).slice(0, 44).padEnd(45)}${String(scope.length).padStart(7)}${String(copies.size).padStart(8)}${String(dated).padStart(7)}${String(threaded).padStart(10)}  ${named}/${scope.length}`,
    )
  }
  if (failures) console.log(`\n${failures} surface(s) incomplete on the relay — that is a migration failure`)
  else console.log(`\nOn the relay: every row in scope is copied, dated with its original created_at, and threaded.`)
  if (pendingWriteback) {
    console.log(`In Convex: ${pendingWriteback} row(s) still read null, so the census cannot see any of this.`)
    console.log(`Run \`writeback\` from an account with Convex admin — that is the remaining step.`)
  }
  console.log(`\nThe gap itself is probe-shr8-census.ts — this only checks what this run wrote.`)
  process.exitCode = failures ? 1 : 0
}

// ── entry ───────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2] ?? 'plan'
  // `writeback` talks to Convex and nothing else. It is also the one mode run
  // by somebody other than the agent, so demanding the agent's relay
  // credential turned "you need Convex admin" into a missing-env error.
  if (mode === 'writeback') return writeback()
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are required')
  const t = await token()
  const agent = tokenSigner(t)
  const query = queryFn(agent)

  switch (mode) {
    case 'plan':
      await plan(query, t.pubkey)
      break
    case 'rehearse': {
      const days = Number(process.argv[3] ?? 400)
      const ok = await preflight(agent, query, Math.round(days * 86_400))
      console.log(`\n${ok ? 'every leg passed' : 'a leg failed'} at ${days} days`)
      process.exitCode = ok ? 0 : 1
      break
    }
    case 'cleanup': {
      // The tidy-up for a rehearsal that died before its own teardown.
      const channelUuid = process.argv[3]
      if (!channelUuid) throw new Error('cleanup needs the throwaway channel uuid')
      const ok = await teardown(agent, query, channelUuid)
      console.log(ok ? `${channelUuid} is down` : `${channelUuid} is not fully down — see above`)
      process.exitCode = ok ? 0 : 1
      break
    }
    case 'migrate':
      await migrate(agent, query)
      break
    case 'writeback':
      await writeback()
      break
    case 'readback':
      await readback(query)
      break
    case 'verify':
      await verify(query, t.pubkey)
      break
    default:
      throw new Error(`unknown mode "${mode}" — plan | rehearse | migrate | writeback | verify | cleanup`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})

export { publish, sleep, stamp, MARK, migrated, origOf, tag, short, keySigner, tokenSigner }
