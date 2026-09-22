/**
 * CON-10 — snapshot both stores before anything irreversible.
 *
 *   ESTIVA_ID_CLIENT_ID=… ESTIVA_ID_CLIENT_SECRET=… \
 *     npx tsx --tsconfig tsconfig.app.json scripts/con10-snapshot.ts [--out DIR]
 *
 * Read-only. It reads Convex's public queries and the relay's `/query`, and it
 * writes only to DIR. It publishes nothing, deletes nothing and mutates
 * nothing in either store.
 *
 * ## What this is, and what it is not
 *
 * It is **not** `convex export`. That needs the account that owns
 * `honorable-guineapig-592`; this machine's `~/.convex/config.json` is an
 * anonymous local deployment, so the agent cannot run one (see the manifest).
 * What it captures instead is everything the public queries project — which is
 * the message content, its authorship, its dates, its `nostrEventId` and its
 * file attachments, i.e. every field this project's migration actually needs
 * to re-create a message. It does not capture reactions' underlying rows, read
 * state, users, or any table with no public reader.
 *
 * Three legs:
 *
 *   1. **Convex content** — `topics:list`, `huddles:list`, and for every
 *      surface `messages:list` plus a `replies:list` per root. Saved raw.
 *   2. **The blobs.** `messages:list` shapes a file attachment through
 *      `ctx.storage.getUrl` (convex/messages.ts), so every Convex-held blob
 *      comes with a fetchable URL. The bytes are downloaded and sha256'd —
 *      these are the only irreplaceable things in the project, and two were
 *      destroyed between the censuses of 2026-09-17 and 2026-09-22.
 *   3. **The relay.** Every event under each topic's `channelUuid`, paged, so
 *      a retraction that hits the wrong bucket can be told afterwards from one
 *      that was already hidden.
 *
 * A soft-deleted channel answers nothing (a `9008` hides everything under the
 * `h`), so leg 3 records a zero rather than failing — the zero is the finding.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CONVEX = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'
const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

const outArg = process.argv.indexOf('--out')
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const OUT =
  outArg !== -1 && process.argv[outArg + 1]
    ? process.argv[outArg + 1]
    : join(process.env.HOME ?? '.', 'estiva-backups', `con10-${STAMP}`)

/** Relay page size. Buzz clamps `limit` per filter; 500 is under the clamp and
 *  the paging loop below does not depend on the exact ceiling. */
const PAGE = 500

/**
 * Every kind buzz-core declares **except** the nine it read-gates, from
 * `crates/buzz-core/src/kind.rs` and `buzz-relay/src/handlers/req.rs` on
 * 2026-09-22:
 *
 *   - `P_GATED_KINDS` — 1059, 24200, 30622, 44100, 44101, 44200
 *   - the agent-engram gate — 30174
 *   - `AUTHOR_ONLY_KINDS` — 30300, 30350
 *
 * Two things make this list load-bearing rather than tidy-up, and both cost a
 * run here before they were understood:
 *
 *   1. **A filter has to name its kinds.** `p_gated_filters_authorized` treats
 *      a kindless filter as able to match a p-gated kind and refuses it,
 *      so `{"#h": [channel]}` — the obvious way to ask for "everything in this
 *      channel" — is a 403 and reads as an empty channel.
 *   2. **One gated kind in the list refuses the whole filter**, not just that
 *      kind. Leaving 30174 in returned zero events for all 26 channels with a
 *      403 that names only the engram rule. A snapshot that swallowed the 403
 *      would have written "0 events" for every channel and looked plausible.
 *
 * The consequence: this captures every kind the relay knows bar those nine,
 * and a kind added to buzz after today would be missed.
 */
const KINDS = [
  0, 1, 3, 5, 7, 9, 41, 1063, 1111, 1617, 1618, 1619, 1621, 1630, 1631, 1632, 1633, 1851, 1984, 8000, 8001, 8002,
  8003, 9000, 9001, 9002, 9005, 9007, 9008, 9009, 9021, 9022, 9035, 9036, 9040, 9041, 9042, 9043, 9044, 9101, 9802,
  10000, 10001, 10002, 10003, 10030, 10100, 13534, 13535, 20001, 20002, 22242, 24134, 24242, 24243, 24810, 27235,
  28936, 30000, 30003, 30023, 30030, 30078, 30175, 30176, 30177, 30315, 30617, 30618, 30620,
  30840, 30841, 30850, 30851, 31989, 31990, 39000, 39001, 39002, 39003, 39005, 39006, 40002, 40003, 40004, 40005,
  40006, 40007, 40008, 40099, 40100, 40901, 40902, 41001, 41010, 41011, 41012, 42000, 43001, 43002, 43003, 43004,
  43005, 43006, 45001, 45002, 45003, 46001, 46002, 46003, 46004, 46005, 46006, 46007, 46010, 46011, 46012, 46020,
  46030, 46031, 48001, 48100, 48101, 48102, 48103, 48106, 49001,
]

interface Token {
  accessToken: string
  pubkey: string
}

async function token(): Promise<Token> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // camelCase — a snake_case body comes back "401 No session cookie".
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

/** As projected by `messages:list` — `url` is present exactly when the bytes
 *  are Convex's; a relay-sourced attachment carries `mediaUrl` and no blob
 *  here to save (CON-12). */
interface FileRow {
  name: string
  contentType: string
  size: number
  storageId?: string
  url?: string
  sha256?: string
  mediaUrl?: string
  thumbUrl?: string
}

interface MsgRow {
  id: string
  createdAt: number
  authorName?: string
  body?: string
  files?: FileRow[]
  nostrEventId?: string | null
  [k: string]: unknown
}

interface BlobEntry {
  index: number
  storageId: string | null
  name: string
  contentType: string
  declaredSize: number
  sha256Declared: string | null
  mediaUrl: string | null
  /** The message or reply this blob hangs off — the ticket's "owning message". */
  owner: {
    surface: string
    channelUuid: string | null
    kind: 'root' | 'reply'
    id: string
    rootId: string | null
    author: string
    createdAt: number
    createdAtIso: string
    nostrEventId: string | null
    bodyExcerpt: string
  }
  saved: {
    ok: boolean
    path: string | null
    bytes: number | null
    sha256: string | null
    note: string | null
  }
}

/** blob index → short-lived download url, kept out of the written files. */
const urls = new Map<number, string | null>()

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)
}

function writeJson(rel: string, value: unknown) {
  const p = join(OUT, rel)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, JSON.stringify(value, null, 2))
  return p
}

/**
 * The inventory a person reads. CON-10's done-when asks for every blob named
 * with its `_storage` id and its owning message, which is a table, not a JSON
 * blob — the JSON stays beside it for anything that has to process the list.
 */
function writeBlobMarkdown(blobs: BlobEntry[], savedBytes: number) {
  const esc = (s: string) => s.replace(/\|/g, '\\|')
  const lines: string[] = []
  lines.push(`# Convex \`_storage\` blob inventory — ${new Date().toISOString().slice(0, 10)}`)
  lines.push('')
  lines.push(
    `${blobs.length} file attachments on non-DM messages; ${blobs.filter((b) => b.saved.ok).length} saved to \`blobs/\` ` +
      `(${(savedBytes / 1024 / 1024).toFixed(2)} MiB). These are the only irreplaceable bytes in the migration.`,
  )
  lines.push('')
  lines.push('| # | storageId | file | type | size | sha256 (of the saved bytes) | owning message | surface | author | date | nostrEventId |')
  lines.push('|--:|---|---|---|--:|---|---|---|---|---|---|')
  for (const b of blobs) {
    lines.push(
      `| ${b.index} | \`${b.storageId ?? '—'}\` | ${esc(b.name)} | ${b.contentType} | ${b.declaredSize} | ` +
        `\`${b.saved.sha256 ?? '—'}\` | \`${b.owner.id}\` (${b.owner.kind}) | ${esc(b.owner.surface)} | ${esc(b.owner.author)} | ` +
        `${b.owner.createdAtIso.slice(0, 10)} | ${b.owner.nostrEventId ? `\`${b.owner.nostrEventId.slice(0, 12)}…\`` : '**none**'} |`,
    )
  }
  const notes = blobs.filter((b) => b.saved.note)
  if (notes.length > 0) {
    lines.push('')
    lines.push('## Notes')
    lines.push('')
    for (const b of notes) lines.push(`- **${b.index}** ${esc(b.name)} — ${esc(b.saved.note as string)}`)
  }
  const p = join(OUT, 'blob-inventory.md')
  writeFileSync(p, lines.join('\n') + '\n')
}

/** The before-picture of the relay, per channel, for CON-6's retraction. */
function writeRelayMarkdown(
  relay: Array<{ surface: string; channelUuid: string; events: number; kinds: Record<string, number>; refusal: string | null }>,
) {
  const esc = (s: string) => s.replace(/\|/g, '\\|')
  const lines: string[] = []
  lines.push(`# Relay before-picture, per topic channel — ${new Date().toISOString().slice(0, 10)}`)
  lines.push('')
  lines.push(
    `${relay.reduce((n, r) => n + r.events, 0)} events across ${relay.length} channels. Full events, with ids, are in ` +
      '`relay/<surface>-<channelUuid>.json`. A retraction hides rather than deletes, so this is what says afterwards ' +
      'which events we hid and which were already hidden.',
  )
  lines.push('')
  lines.push('| events | surface | channelUuid | kinds | refusal |')
  lines.push('|--:|---|---|---|---|')
  for (const r of [...relay].sort((a, b) => b.events - a.events)) {
    const kinds = Object.entries(r.kinds)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([k, n]) => `${k}×${n}`)
      .join(' ')
    lines.push(`| ${r.events} | ${esc(r.surface)} | \`${r.channelUuid}\` | ${kinds || '—'} | ${r.refusal ? esc(r.refusal) : '—'} |`)
  }
  writeFileSync(join(OUT, 'relay-inventory.md'), lines.join('\n') + '\n')
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are required')
  const startedAt = new Date().toISOString()
  mkdirSync(join(OUT, 'convex'), { recursive: true })
  mkdirSync(join(OUT, 'blobs'), { recursive: true })
  mkdirSync(join(OUT, 'relay'), { recursive: true })
  const t = await token()
  console.log(`out:    ${OUT}`)
  console.log(`convex: ${CONVEX}`)
  console.log(`relay:  ${RELAY_URL}\n`)

  // ── Leg 1: Convex content ────────────────────────────────────────────────
  type Topic = { id: string; title: string; channelUuid?: string; [k: string]: unknown }
  type Huddle = { id: string; title?: string; name?: string; channelUuid?: string; [k: string]: unknown }
  const topics = await convex<Topic[]>('topics:list', {})
  const huddles = await convex<Huddle[]>('huddles:list', {})
  writeJson('convex/topics.json', topics)
  writeJson('convex/huddles.json', huddles)
  console.log(`convex: ${topics.length} topics, ${huddles.length} huddles`)

  const surfaces: Array<{ surface: string; parentKind: 'topic' | 'huddle'; parentKey: string; channelUuid: string | null }> = [
    ...topics.map((x) => ({ surface: `topic/${x.title}`, parentKind: 'topic' as const, parentKey: x.id, channelUuid: x.channelUuid ?? null })),
    ...huddles.map((x) => ({
      surface: `huddle/${x.title ?? x.name ?? x.id}`,
      parentKind: 'huddle' as const,
      parentKey: x.id,
      channelUuid: x.channelUuid ?? null,
    })),
  ]

  const blobs: BlobEntry[] = []
  const content: Array<{ surface: string; parentKind: string; parentKey: string; channelUuid: string | null; roots: MsgRow[]; replies: Record<string, MsgRow[]> }> = []
  let msgCount = 0

  for (const s of surfaces) {
    const page = await convex<{ rows: MsgRow[] }>('messages:list', { parentKind: s.parentKind, parentKey: s.parentKey })
    const replies: Record<string, MsgRow[]> = {}
    for (const m of page.rows) {
      replies[m.id] = await convex<MsgRow[]>('replies:list', { messageKey: m.id })
    }
    msgCount += page.rows.length + Object.values(replies).reduce((n, r) => n + r.length, 0)
    content.push({ surface: s.surface, parentKind: s.parentKind, parentKey: s.parentKey, channelUuid: s.channelUuid, roots: page.rows, replies })

    const record = (row: MsgRow, kind: 'root' | 'reply', rootId: string | null) => {
      for (const f of row.files ?? []) {
        blobs.push({
          index: blobs.length + 1,
          storageId: f.storageId ?? null,
          name: f.name,
          contentType: f.contentType,
          declaredSize: f.size,
          sha256Declared: f.sha256 ?? null,
          mediaUrl: f.mediaUrl ?? null,
          owner: {
            surface: s.surface,
            channelUuid: s.channelUuid,
            kind,
            id: row.id,
            rootId,
            author: row.authorName ?? '?',
            createdAt: row.createdAt,
            createdAtIso: new Date(row.createdAt).toISOString(),
            nostrEventId: row.nostrEventId ?? null,
            bodyExcerpt: String(row.body ?? '').replace(/\s+/g, ' ').slice(0, 80),
          },
          // Filled by leg 2. `url` is what decides whether there are bytes
          // here at all: no url means the row points at the relay's copy.
          saved: { ok: false, path: null, bytes: null, sha256: null, note: f.url ? null : 'no Convex url — relay-sourced attachment (CON-12), no blob in this deployment' },
        })
        // Stash the url out of band; it is short-lived and does not belong in
        // a file that gets committed to a backup directory.
        urls.set(blobs.length, f.url ?? null)
      }
    }
    for (const m of page.rows) {
      record(m, 'root', null)
      for (const r of replies[m.id] ?? []) record(r, 'reply', m.id)
    }
  }
  writeJson('convex/messages.json', content)
  console.log(`convex: ${msgCount} non-DM messages saved, ${blobs.length} file attachments referenced`)

  // ── Leg 2: the bytes ─────────────────────────────────────────────────────
  let saved = 0
  let savedBytes = 0
  for (const b of blobs) {
    const url = urls.get(b.index)
    if (!url) continue
    const rel = join('blobs', `${String(b.index).padStart(3, '0')}-${b.storageId ?? 'nostorage'}-${safeName(b.name)}`)
    try {
      // Re-running is cheap on purpose: a blob already on disk at its declared
      // size is not re-fetched. The snapshot is meant to be re-run beside each
      // census, and a full re-download of 30 MiB of production bytes to
      // re-learn what is already saved is the kind of cost that stops it being
      // re-run at all.
      let buf: Buffer
      const existing = (() => {
        try {
          return statSync(join(OUT, rel)).size
        } catch {
          return -1
        }
      })()
      if (existing === b.declaredSize) {
        buf = readFileSync(join(OUT, rel))
      } else {
        const res = await fetch(url)
        if (!res.ok) {
          b.saved.note = `GET blob: ${res.status}`
          continue
        }
        buf = Buffer.from(await res.arrayBuffer())
        writeFileSync(join(OUT, rel), buf)
      }
      b.saved = {
        ok: true,
        path: rel,
        bytes: buf.length,
        sha256: createHash('sha256').update(buf).digest('hex'),
        note: buf.length === b.declaredSize ? null : `size mismatch: row says ${b.declaredSize}, got ${buf.length}`,
      }
      saved += 1
      savedBytes += buf.length
    } catch (e) {
      b.saved.note = `GET blob threw: ${String(e)}`
    }
  }
  writeJson('blob-inventory.json', blobs)
  writeBlobMarkdown(blobs, savedBytes)
  console.log(`blobs:  ${saved}/${blobs.length} on disk, ${(savedBytes / 1024 / 1024).toFixed(2)} MiB`)

  // ── Leg 3: the relay side, per channel ───────────────────────────────────
  const channels = surfaces.filter((s) => s.channelUuid)
  const relay: Array<{ surface: string; channelUuid: string; events: number; kinds: Record<string, number>; refusal: string | null; ids: string[] }> = []
  for (const s of channels) {
    const seen = new Map<string, SignedEvent>()
    // A refused channel and an empty channel both end up with zero events, and
    // only this distinguishes them. It is written into the index so nothing
    // downstream can read a refusal as "this channel holds nothing".
    let refusal: string | null = null
    let until: number | undefined
    for (;;) {
      const filter: Record<string, unknown> = { '#h': [s.channelUuid], kinds: KINDS, limit: PAGE }
      if (until !== undefined) filter.until = until
      const res = await query([filter], t)
      if (res.status !== 200) {
        refusal = `${res.status} ${res.text.slice(0, 160)}`
        console.log(`⚠  ${s.surface}: /query ${refusal}`)
        break
      }
      const fresh = res.events.filter((e) => !seen.has(e.id))
      for (const e of res.events) seen.set(e.id, e)
      if (fresh.length === 0 || res.events.length < PAGE) break
      until = Math.min(...res.events.map((e) => e.created_at))
    }
    const events = [...seen.values()].sort((a, b) => a.created_at - b.created_at)
    const kinds: Record<string, number> = {}
    for (const e of events) kinds[String(e.kind)] = (kinds[String(e.kind)] ?? 0) + 1
    writeJson(`relay/${safeName(s.surface)}-${s.channelUuid}.json`, events)
    relay.push({ surface: s.surface, channelUuid: s.channelUuid as string, events: events.length, kinds, refusal, ids: events.map((e) => e.id) })
  }
  writeJson('relay/index.json', relay)
  writeRelayMarkdown(relay)
  const relayTotal = relay.reduce((n, r) => n + r.events, 0)
  const refused = relay.filter((r) => r.refusal)
  const empty = relay.filter((r) => !r.refusal && r.events === 0)
  console.log(
    `relay:  ${relayTotal} events across ${relay.length} channels; ${empty.length} genuinely empty, ${refused.length} refused`,
  )

  writeJson('snapshot-meta.json', {
    ticket: 'CON-10',
    startedAt,
    finishedAt: new Date().toISOString(),
    convexUrl: CONVEX,
    relayUrl: RELAY_URL,
    counts: {
      topics: topics.length,
      huddles: huddles.length,
      messages: msgCount,
      fileAttachments: blobs.length,
      blobsDownloaded: saved,
      blobBytes: savedBytes,
      relayChannels: relay.length,
      relayEvents: relayTotal,
      relayEmptyChannels: empty.length,
      relayRefusedChannels: refused.length,
    },
  })
  console.log(`\ndone — ${OUT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
