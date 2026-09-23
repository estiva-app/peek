/**
 * DMS-7: republish the DMs that exist only in Convex, as their authors, with
 * their real dates — Miky's option 1 (2026-09-22).
 *
 *   cd ~/peek-dms7-work
 *   S=~/estiva-backups/con9-20260923/convex-export-20260923-with-storage.zip
 *   npx tsx --tsconfig tsconfig.app.json scripts/dms7-migrate.ts plan      --snapshot $S
 *   npx tsx --tsconfig tsconfig.app.json scripts/dms7-migrate.ts migrate   --snapshot $S --keys ~/.dms7-keys.json
 *   npx tsx --tsconfig tsconfig.app.json scripts/dms7-migrate.ts writeback            # Convex admin
 *   npx tsx --tsconfig tsconfig.app.json scripts/dms7-migrate.ts verify    --snapshot $S --as <token file>
 *
 * `plan` is read-only and needs nothing but the snapshot. `migrate` writes to
 * production and needs every author's key. `writeback` needs Convex admin.
 * `verify` needs one participant's signer — a DM channel is private, so the
 * agent's own `/query` answers `[]` for it and would score every row missing.
 *
 * ## Why the snapshot, not Convex
 *
 * Convex's DM queries resolve through `viewerId()`, which is null for the agent
 * (CON-9), so the only readable copy of these rows is the export — which also
 * holds the 17 blobs that were never uploaded, as `_storage/<id>.<ext>`. And a
 * snapshot names every row by its `_id`, so the write-back needs no seedKey
 * map, unlike SHR-8's.
 *
 * ## What it publishes — the live shapes, and nothing else
 *
 * Exactly what `convex/nostr/outbox.ts` builds for a DM written today, so a
 * migrated conversation is indistinguishable from a live one:
 *
 *  - a root is `buildMessage` against the DM's channel, with `imeta` for its
 *    files (`unsignedMessage`);
 *  - a reply is the same with `threadRef` naming its root (`unsignedReply`) —
 *    Peek's replies are flat, so root and parent are one event;
 *  - a reaction is `buildReaction` on the copy it targets (`unsignedReaction`);
 *  - a resolution is `buildResolution` (`unsignedResolution`).
 *
 * `urgent` and `highlightType` do not travel for a live DM either, so they do
 * not travel here. Each event additionally carries `orig` — the Convex `_id`,
 * its true second and its author — and `migration: dms7-migrate`, so a re-run
 * skips what is already there and `verify` can match the two stores.
 *
 * ## Run it straight into the write-back
 *
 * Peek's live sync imports a DM channel's `kind:9`s into Convex and matches
 * them to rows **by `nostrEventId`** (`convex/nostr/data.ts`, `by_nostrEventId`).
 * Until the write-back lands, a migrated event matches no row, so a participant
 * who opens the DM in that gap gets every message imported a second time. So
 * `migrate` → `writeback` is one sitting, with Peek closed on both sides.
 */
import {
  authorizationHeaderFor,
  buildMessage,
  buildReaction,
  buildResolution,
  buildUnsignedAuthEvent,
  fetchBlob,
  imetaTag,
  publicKeyFromSecret,
  sha256Of,
  signEvent,
  uploadBlob,
} from '@estiva-app/protocol'
import type { NostrTag, SignedEvent, UnsignedEvent, UploadedBlob } from '@estiva-app/protocol'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { mentionedPubkeys, referencedAddresses } from '../convex/nostr/refs.js'
import { sanitizeForRelay } from './con5-sanitize-media.js'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CONVEX = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'

/** Between writes: the relay's quota trips after a handful in a row (FOL-25). */
const WRITE_GAP_MS = 6_000
const MARK = 'dms7-migrate'
/** Outside the repo: both name production rows. */
const BLOBS = process.env.DMS7_BLOBS ?? `${homedir()}/dms7-blobs.jsonl`
const WRITEBACK = process.env.DMS7_WRITEBACK ?? `${homedir()}/dms7-writeback.json`

const argValue = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i > 0 ? process.argv[i + 1] : undefined
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const short = (s: string) => s.slice(0, 8)
const stamp = (secs: number) => new Date(secs * 1000).toISOString().slice(0, 16).replace('T', ' ')
const secs = (ms: number) => Math.floor(ms / 1000)
const origOf = (e: SignedEvent) => e.tags.find((x) => x[0] === 'orig')?.[1]
const migrated = (e: SignedEvent) => e.tags.some((x) => x[0] === 'migration' && x[1] === MARK)

// ── signing and the bridge ──────────────────────────────────────────────────

type Signer = { pubkey: string; sign: (u: UnsignedEvent) => Promise<SignedEvent> }

const keySigner = (secretHex: string): Signer => ({ pubkey: publicKeyFromSecret(secretHex), sign: async (u) => signEvent(u, secretHex) })

/** A person's Estiva ID token (`sessionStorage["peek.estivaId.token"]`): `/sign` signs as them. */
const tokenSigner = (t: { pubkey: string; accessToken: string }): Signer => ({
  pubkey: t.pubkey,
  sign: async (unsigned) => {
    const res = await fetch(`${ID_ORIGIN}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${t.accessToken}` },
      body: JSON.stringify({ event: unsigned }),
    })
    if (!res.ok) throw new Error(`POST /sign: ${res.status} ${await res.text()}`)
    return ((await res.json()) as { event: SignedEvent }).event
  },
})

/** `--keys {"<pubkey>": "<secret>"}` and/or `--as [{pubkey, accessToken}]`. */
function loadSigners(): Map<string, Signer> {
  const out = new Map<string, Signer>()
  const keys = argValue('--keys')
  if (keys) {
    for (const [pubkey, secret] of Object.entries(JSON.parse(readFileSync(keys, 'utf8')) as Record<string, string>)) {
      // Checked before anything is written: a mis-pasted key otherwise surfaces
      // as a relay refusal with nothing to connect it to the line that caused it.
      const derived = publicKeyFromSecret(secret)
      if (derived !== pubkey) throw new Error(`--keys: the key filed under ${short(pubkey)}… derives ${short(derived)}…`)
      out.set(pubkey, keySigner(secret))
    }
  }
  const as = argValue('--as')
  if (as) {
    const raw = JSON.parse(readFileSync(as, 'utf8')) as Array<{ pubkey: string; accessToken: string }> | { pubkey: string; accessToken: string }
    for (const t of Array.isArray(raw) ? raw : [raw]) if (!out.has(t.pubkey)) out.set(t.pubkey, tokenSigner(t))
  }
  return out
}

async function bridge(path: '/query' | '/events', payload: unknown, s: Signer): Promise<{ status: number; text: string }> {
  const url = `${RELAY_URL}${path}`
  const body = JSON.stringify(payload)
  const auth = await s.sign(buildUnsignedAuthEvent({ pubkey: s.pubkey, url, method: 'POST', body }))
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) }, body })
  return { status: res.status, text: await res.text() }
}

async function query(filters: Record<string, unknown>[], s: Signer): Promise<SignedEvent[]> {
  const { status, text } = await bridge('/query', filters, s)
  if (status !== 200) throw new Error(`POST /query: ${status} ${text.slice(0, 200)}`)
  return JSON.parse(text) as SignedEvent[]
}

/** The relay refuses as `200` with `accepted: false`, or a bare 500 (the commit floor), or 400 (drift). */
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

// ── the snapshot ────────────────────────────────────────────────────────────

interface File {
  name: string
  contentType: string
  size: number
  storageId?: string
  sha256?: string
  mediaUrl?: string
  dim?: string
  thumbUrl?: string
}
interface Row {
  table: 'messages' | 'replies'
  id: string
  /** For a reply, its root's `_id`. */
  rootId?: string
  dm: string
  authorId: string
  pubkey: string
  createdAt: number
  body: string
  files: File[]
  nostrEventId?: string
}
interface Reaction {
  id: string
  messageId: string
  replyId?: string
  userId: string
  pubkey: string
  emoji: string
  createdAt: number
  nostrEventId?: string
}
interface Assertion {
  id: string
  messageId: string
  authorId: string
  pubkey: string
  action: 'resolved' | 'reopened'
  rationale?: string
  supportingReplyId?: string
  createdAt: number
  nostrEventId?: string
}
interface Snapshot {
  people: Map<string, { name: string; pubkey?: string }>
  channels: Map<string, string>
  rows: Row[]
  reactions: Reaction[]
  assertions: Assertion[]
  /** storageId → bytes, only for files this run may upload. */
  blobs: Map<string, Buffer>
}

/**
 * The DM tables out of a `convex export --include-file-storage` zip. Node has no
 * archive reader and this machine has no `unzip`, so python3 opens it, as the
 * census does. Only DM rows cross over, and only the blobs of never-published
 * rows — the bodies stay in this process's memory.
 */
function readSnapshot(zip: string): Snapshot {
  const PY = `
import json,sys,zipfile,base64
z=zipfile.ZipFile(sys.argv[1])
def t(n): return [json.loads(l) for l in z.read(n+'/documents.jsonl').decode('utf-8').splitlines() if l.strip()]
msgs=[m for m in t('messages') if m.get('parentKind')=='dm']
ids={m['_id'] for m in msgs}
reps=[r for r in t('replies') if r.get('messageId') in ids]
want={f['storageId'] for m in msgs+reps if not m.get('nostrEventId') for f in (m.get('fileAttachments') or []) if f.get('storageId') and not f.get('sha256')}
blobs={}
for n in z.namelist():
    if n.startswith('_storage/') and not n.endswith('.jsonl'):
        sid=n.split('/',1)[1].split('.',1)[0]
        if sid in want: blobs[sid]=base64.b64encode(z.read(n)).decode()
json.dump({'users':t('users'),'dms':t('dmConversations'),'messages':msgs,'replies':reps,
  'reactions':[r for r in t('reactions') if r.get('messageId') in ids],
  'assertions':[a for a in t('resolutionAssertions') if a.get('messageId') in ids],'blobs':blobs},sys.stdout)
`
  type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const raw = JSON.parse(execFileSync('python3', ['-c', PY, zip], { maxBuffer: 1 << 29 }).toString()) as Record<string, Doc[]> & { blobs: Record<string, string> }
  const people = new Map<string, { name: string; pubkey?: string }>(raw.users.map((u) => [u._id, { name: u.name ?? short(u._id), pubkey: u.nostrPubkey }]))
  const pk = (userId: string) => {
    const p = people.get(userId)?.pubkey
    if (!p) throw new Error(`no nostrPubkey for user ${userId} (${people.get(userId)?.name ?? '?'})`)
    return p
  }
  const roots = new Map(raw.messages.map((m) => [m._id, m]))
  const rows: Row[] = [
    ...raw.messages.map((m): Row => ({ table: 'messages', id: m._id, dm: m.parentId, authorId: m.authorId, pubkey: pk(m.authorId), createdAt: m.createdAt, body: String(m.body ?? ''), files: m.fileAttachments ?? [], nostrEventId: m.nostrEventId })),
    ...raw.replies.map((r): Row => ({ table: 'replies', id: r._id, rootId: r.messageId, dm: roots.get(r.messageId)!.parentId, authorId: r.authorId, pubkey: pk(r.authorId), createdAt: r.createdAt, body: String(r.body ?? ''), files: r.fileAttachments ?? [], nostrEventId: r.nostrEventId })),
  ]
  return {
    people,
    channels: new Map(raw.dms.filter((d) => d.channelUuid).map((d) => [d._id, d.channelUuid])),
    rows,
    reactions: raw.reactions.map((r) => ({ id: r._id, messageId: r.messageId, replyId: r.replyId, userId: r.userId, pubkey: pk(r.userId), emoji: r.emoji, createdAt: r.createdAt, nostrEventId: r.nostrEventId })),
    assertions: raw.assertions.map((a) => ({ id: a._id, messageId: a.messageId, authorId: a.authorId, pubkey: a.authorPubkey ?? pk(a.authorId), action: a.action, rationale: a.rationale, supportingReplyId: a.supportingReplyId, createdAt: a.createdAt, nostrEventId: a.nostrEventId })),
    blobs: new Map(Object.entries(raw.blobs).map(([k, v]) => [k, Buffer.from(v, 'base64')])),
  }
}

/** What this ticket owes: every never-published row, and what hangs off one. */
function population(s: Snapshot) {
  const rows = s.rows.filter((r) => !r.nostrEventId)
  const gap = new Set(rows.map((r) => r.id))
  // A reaction or resolution on a row that *is* published was Peek's live
  // outbox's to send; one on a gap row could never have been sent, because its
  // target had no event. Only the second kind is this run's.
  const reactions = s.reactions.filter((r) => !r.nostrEventId && gap.has(r.replyId ?? r.messageId))
  const assertions = s.assertions.filter((a) => !a.nostrEventId && gap.has(a.messageId))
  const orphans = [...s.reactions, ...s.assertions].filter((x) => !x.nostrEventId && !reactions.includes(x as Reaction) && !assertions.includes(x as Assertion))
  return { rows, reactions, assertions, orphans }
}

// ── plan ────────────────────────────────────────────────────────────────────

function plan(s: Snapshot) {
  const { rows, reactions, assertions, orphans } = population(s)
  const name = (pubkey: string) => [...s.people.values()].find((p) => p.pubkey === pubkey)?.name ?? '?'
  console.log(`snapshot: ${s.rows.length} DM rows, ${s.channels.size} DM channel(s) on the relay`)
  console.log(`to publish: ${rows.length} rows (${rows.filter((r) => r.table === 'messages').length} roots, ${rows.filter((r) => r.table === 'replies').length} replies), ${reactions.length} reactions, ${assertions.length} resolution(s)`)
  const noChannel = rows.filter((r) => !s.channels.has(r.dm))
  if (noChannel.length) console.log(`!! ${noChannel.length} row(s) in a DM with no relay channel — open it first (DMS-3)`)
  if (orphans.length) console.log(`!! ${orphans.length} unpublished reaction/resolution on a *published* row — not this run's; the live outbox owns it`)

  const tally = new Map<string, number>()
  for (const x of [...rows, ...reactions, ...assertions]) tally.set(x.pubkey, (tally.get(x.pubkey) ?? 0) + 1)
  console.log(`\nsigners this needs:`)
  for (const [pk, n] of tally) console.log(`   ${String(n).padStart(4)}  ${pk}  ${name(pk)}`)

  const files = rows.flatMap((r) => r.files)
  const onRelay = files.filter((f) => f.sha256 && f.mediaUrl)
  const toUpload = files.filter((f) => !(f.sha256 && f.mediaUrl))
  const inSnapshot = toUpload.filter((f) => f.storageId && s.blobs.has(f.storageId))
  console.log(`\nattachments: ${files.length} — ${onRelay.length} already in the blob store, ${toUpload.length} to upload (${inSnapshot.length} present in the snapshot)`)
  if (inSnapshot.length < toUpload.length) console.log(`!! ${toUpload.length - inSnapshot.length} file(s) have no bytes anywhere — migrate refuses to start`)

  const oldest = Math.min(...rows.map((r) => r.createdAt), ...reactions.map((r) => r.createdAt), ...assertions.map((a) => a.createdAt))
  const age = Math.ceil((Date.now() - oldest) / 1000) + 3600
  const writes = rows.length + reactions.length + assertions.length
  console.log(`\noldest: ${stamp(secs(oldest))} UTC. Window needed: BUZZ_MAX_TIMESTAMP_DRIFT_SECS=${age} and BUZZ_CREATED_AT_FLOOR_SECS=${age}`)
  console.log(`writes: ${writes} events + ${toUpload.length} uploads, about ${Math.ceil(((writes + toUpload.length) * WRITE_GAP_MS) / 60_000)} min`)
}

// ── what is already on the relay ────────────────────────────────────────────

/** This run's copies already in each channel, by the Convex `_id` they stand for. */
async function copiesOnRelay(s: Snapshot, reader: Signer): Promise<Map<string, SignedEvent>> {
  const out = new Map<string, SignedEvent>()
  for (const channel of new Set(s.channels.values())) {
    // One kind per filter: a bare or mixed `#h` read is refused whole if any kind in it is gated.
    for (const kind of [9, 9101]) {
      for (const e of await query([{ kinds: [kind], '#h': [channel], limit: 2000 }], reader)) {
        const o = origOf(e)
        if (o && migrated(e)) out.set(o, e)
      }
    }
  }
  // A reaction carries no `h` — its channel is derived from its target — so it is read by target.
  const targets = [...out.values()].filter((e) => e.kind === 9).map((e) => e.id)
  for (let i = 0; i < targets.length; i += 100) {
    for (const e of await query([{ kinds: [7], '#e': targets.slice(i, i + 100), limit: 2000 }], reader)) {
      const o = origOf(e)
      if (o && migrated(e)) out.set(o, e)
    }
  }
  return out
}

// ── migrate ─────────────────────────────────────────────────────────────────

interface BlobLine {
  storageId: string
  rowId: string
  blob: UploadedBlob
  filename: string
  verifiedAt: string
}

function readBlobManifest(): Map<string, BlobLine> {
  if (!existsSync(BLOBS)) return new Map()
  const lines = readFileSync(BLOBS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as BlobLine)
  return new Map(lines.map((l) => [l.storageId, l]))
}

/** The `imeta` for a file, from the relay's own descriptor where this run uploaded it. */
function imetaFor(f: File, uploaded: Map<string, BlobLine>): NostrTag {
  const up = f.storageId ? uploaded.get(f.storageId) : undefined
  if (up) return imetaTag({ url: up.blob.url, m: up.blob.type, x: up.blob.sha256, size: up.blob.size, dim: up.blob.dim, thumb: up.blob.thumb, filename: f.name })
  // Already in the blob store: the row holds the relay's answers (outbox `imetaTagsFor`).
  return imetaTag({ url: f.mediaUrl!, m: f.contentType, x: f.sha256!, size: f.size, dim: f.dim, thumb: f.thumbUrl, filename: f.name })
}

async function migrate(s: Snapshot) {
  const { rows, reactions, assertions } = population(s)
  const signers = loadSigners()
  const problems: string[] = []
  for (const pk of new Set([...rows, ...reactions, ...assertions].map((x) => x.pubkey))) {
    if (!signers.has(pk)) problems.push(`no signer for ${short(pk)}…`)
  }
  for (const r of rows) {
    if (!s.channels.has(r.dm)) problems.push(`${short(r.id)}: its DM has no channel`)
    for (const f of r.files) if (!(f.sha256 && f.mediaUrl) && !(f.storageId && s.blobs.has(f.storageId))) problems.push(`${short(r.id)}: no bytes for ${f.name}`)
  }
  if (problems.length) {
    console.log(`nothing written — ${problems.length} problem(s):`)
    for (const p of new Set(problems)) console.log(`    ${p}`)
    throw new Error('migrate refused to start')
  }

  // Either participant can read the whole channel; the first signer will do.
  const reader = signers.get(rows[0]!.pubkey)!
  const done = await copiesOnRelay(s, reader)
  console.log(`already on the relay from an earlier run: ${done.size}`)

  // ── 1. the bytes. Before any event: ingest refuses an `imeta` naming a blob the store lacks.
  const uploaded = readBlobManifest()
  for (const r of rows) {
    if (done.has(r.id)) continue
    for (const f of r.files) {
      if ((f.sha256 && f.mediaUrl) || uploaded.has(f.storageId!)) continue
      const signer = signers.get(r.pubkey)!
      const bytes = s.blobs.get(f.storageId!)!
      if (bytes.byteLength !== f.size) throw new Error(`${f.name}: snapshot holds ${bytes.byteLength} bytes, the row says ${f.size}`)
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const blob = await uploadBlob({ relayUrl: RELAY_URL, bytes: sanitizeForRelay(ab, f.contentType), contentType: f.contentType || undefined, filename: f.name, sign: signer.sign, pubkey: signer.pubkey })
      // The upload's 200 is the mechanism; the bytes read back are the claim.
      const back = await fetchBlob({ relayUrl: RELAY_URL, url: blob.url, sign: signer.sign, pubkey: signer.pubkey })
      if (sha256Of(back.bytes) !== blob.sha256) throw new Error(`${f.name}: read back ${sha256Of(back.bytes)}, descriptor says ${blob.sha256}`)
      const line: BlobLine = { storageId: f.storageId!, rowId: r.id, blob, filename: f.name, verifiedAt: new Date().toISOString() }
      appendFileSync(BLOBS, JSON.stringify(line) + '\n', { mode: 0o600 })
      uploaded.set(line.storageId, line)
      console.log(`  blob ${short(f.storageId!)} → ${blob.url} (${blob.type}, ${blob.size} bytes, read back)`)
      await sleep(WRITE_GAP_MS)
    }
  }

  // ── 2. the events, roots before replies: a reply's `e` is its root's id.
  const pending: Array<{ table: 'messages' | 'replies' | 'reactions'; id: string; nostrEventId: string }> = []
  const copyOf = (id: string) => done.get(id)?.id ?? s.rows.find((r) => r.id === id)?.nostrEventId
  let refused = 0
  let first = true
  const write = async (origId: string, pubkey: string, createdAt: number, unsigned: UnsignedEvent, table?: 'messages' | 'replies' | 'reactions') => {
    unsigned.tags.push(['orig', origId, String(secs(createdAt)), pubkey], ['migration', MARK])
    const r = await publish(unsigned, signers.get(pubkey)!)
    await sleep(WRITE_GAP_MS)
    if (!r.ok) {
      refused++
      const why = r.status === 400 ? 'the drift gate — BUZZ_MAX_TIMESTAMP_DRIFT_SECS' : r.status === 500 ? 'a bare 500 is the commit floor — BUZZ_CREATED_AT_FLOOR_SECS' : ''
      console.log(`  ${short(origId)} by ${short(pubkey)} → REFUSED ${r.status} ${r.reason}${why ? ` (${why})` : ''}`)
      if (first) throw new Error('the first write was refused: the back-dating window is not open. Nothing else was attempted.')
      return
    }
    if (first) {
      // The floor aborts at COMMIT, so "accepted" is a claim about a transaction
      // that had not finished. Only a read proves the oldest row survived.
      const back = await query([{ ids: [r.id], limit: 1 }], reader)
      if (back[0]?.created_at !== unsigned.created_at) throw new Error(`the first write (${short(r.id)}) was accepted but does not read back with its date — the floor took it at COMMIT`)
      console.log(`  first write read back at ${stamp(back[0].created_at)} UTC — the window is open`)
      first = false
    }
    done.set(origId, { ...unsigned, id: r.id } as SignedEvent)
    if (table) pending.push({ table, id: origId, nostrEventId: r.id })
  }

  const ordered = [...rows].sort((a, b) => (a.table === b.table ? a.createdAt - b.createdAt : a.table === 'messages' ? -1 : 1))
  for (const r of ordered) {
    if (done.has(r.id)) continue
    const rootEvent = r.rootId ? copyOf(r.rootId) : undefined
    if (r.rootId && !rootEvent) {
      console.log(`  ${short(r.id)} — its root has no event after the roots' pass; skipped`)
      refused++
      continue
    }
    const unsigned = buildMessage(r.pubkey, r.createdAt, {
      channelUuid: s.channels.get(r.dm)!,
      content: r.body,
      ...(rootEvent ? { threadRef: { rootId: rootEvent, parentId: rootEvent } } : { about: referencedAddresses(r.body) }),
      mentions: mentionedPubkeys(r.body),
      mediaTags: r.files.map((f) => imetaFor(f, uploaded)),
    })
    await write(r.id, r.pubkey, r.createdAt, unsigned, r.table)
  }
  for (const x of reactions) {
    const target = copyOf(x.replyId ?? x.messageId)
    if (done.has(x.id) || !target) continue
    await write(x.id, x.pubkey, x.createdAt, buildReaction(x.pubkey, x.createdAt, { targetEventId: target, emoji: x.emoji }), 'reactions')
  }
  for (const a of assertions) {
    const target = copyOf(a.messageId)
    const root = s.rows.find((r) => r.id === a.messageId)!
    if (done.has(a.id) || !target) continue
    const supporting = a.supportingReplyId ? copyOf(a.supportingReplyId) : undefined
    // No write-back: `resolutionAssertions` has no internal mark mutation, and
    // the census does not count assertions. `verify` reads it off the relay.
    await write(a.id, a.pubkey, a.createdAt, buildResolution(a.pubkey, a.createdAt, { channelUuid: s.channels.get(root.dm)!, targetEventId: target, action: a.action, supportingEventId: supporting, rationale: a.rationale }))
  }

  // Merged with an earlier interrupted run's list rather than overwriting it.
  const prior = existsSync(WRITEBACK) ? (JSON.parse(readFileSync(WRITEBACK, 'utf8')) as typeof pending) : []
  const merged = new Map([...prior, ...pending].map((p) => [p.id, p]))
  writeFileSync(WRITEBACK, JSON.stringify([...merged.values()], null, 2), { mode: 0o600 })
  console.log(`\npublished ${pending.length}, refused ${refused}. ${merged.size} write-back(s) in ${WRITEBACK}.`)
  console.log(`Now, before either of you opens Peek: scripts/dms7-migrate.ts writeback`)
  process.exitCode = refused ? 1 : 0
}

// ── writeback ───────────────────────────────────────────────────────────────

/**
 * Stamp each published event id onto its Convex row, from somebody with admin.
 *
 * A key signs but authenticates nothing against Convex, and the public
 * `record*Published` mutations are viewer-gated and return silently for anyone
 * else. The internal marks have no viewer check and take the `_id` the
 * snapshot already gave us.
 *
 * Then it exports a fresh snapshot and reads the columns back: `convex run`
 * exiting 0 says the call was made, not that the column moved.
 */
async function writeback() {
  const deployment = process.env.CONVEX_DEPLOYMENT_NAME ?? new URL(CONVEX).hostname.split('.')[0]!
  const rows = JSON.parse(readFileSync(WRITEBACK, 'utf8')) as Array<{ table: 'messages' | 'replies' | 'reactions'; id: string; nostrEventId: string }>
  const fn = { messages: ['nostr/data:markMessagePublished', 'messageId'], replies: ['nostr/data:markReplyPublished', 'replyId'], reactions: ['nostr/data:markReactionPublished', 'reactionId'] } as const
  console.log(`${rows.length} write-back(s) to ${deployment}`)
  let called = 0
  for (const r of rows) {
    const [path, arg] = fn[r.table]
    try {
      execFileSync('npx', ['convex', 'run', '--deployment', deployment, path, JSON.stringify({ [arg]: r.id, nostrEventId: r.nostrEventId })], { stdio: 'pipe' })
      called++
    } catch (e) {
      console.log(`  ${r.table} ${short(r.id)} → ${e instanceof Error ? e.message.split('\n')[0] : e}`)
    }
  }
  const after = `${homedir()}/estiva-backups/dms7-after-writeback-${new Date().toISOString().slice(0, 10)}.zip`
  console.log(`calls that returned: ${called}/${rows.length}\nexporting ${after} to read the columns back …`)
  execFileSync('npx', ['convex', 'export', '--deployment', deployment, '--path', after], { stdio: 'inherit' })
  const PY = `
import json,sys,zipfile
z=zipfile.ZipFile(sys.argv[1])
out={}
for t in ('messages','replies','reactions'):
    for l in z.read(t+'/documents.jsonl').decode('utf-8').splitlines():
        if l.strip():
            d=json.loads(l); out[d['_id']]=d.get('nostrEventId')
json.dump(out,sys.stdout)
`
  const col = JSON.parse(execFileSync('python3', ['-c', PY, after], { maxBuffer: 1 << 28 }).toString()) as Record<string, string | null>
  const landed = rows.filter((r) => col[r.id] === r.nostrEventId).length
  console.log(`rows whose column now names the event: ${landed}/${rows.length}`)
  console.log(`\ncensus: npx tsx --tsconfig tsconfig.app.json scripts/probe-shr8-census.ts --snapshot ${after}`)
  process.exitCode = landed === rows.length ? 0 : 1
}

// ── verify ──────────────────────────────────────────────────────────────────

/**
 * The done-when, read off the relay as a participant: every gap row has a copy
 * with its true date and its author, threaded, with an `imeta` per file whose
 * bytes read back; every reaction and resolution is there on the right copy.
 */
async function verify(s: Snapshot) {
  const { rows, reactions, assertions } = population(s)
  const signers = loadSigners()
  const reader = [...signers.values()][0]
  if (!reader) throw new Error('verify needs a participant: --as <token file> or --keys <file>')
  const copies = await copiesOnRelay(s, reader)
  const fail: string[] = []
  const check = (ok: boolean, what: string) => {
    if (!ok) fail.push(what)
  }
  let blobsRead = 0
  for (const r of rows) {
    const e = copies.get(r.id)
    if (!e) {
      fail.push(`${r.table} ${short(r.id)}: no copy`)
      continue
    }
    check(e.created_at === secs(r.createdAt), `${short(r.id)}: dated ${stamp(e.created_at)}, row says ${stamp(secs(r.createdAt))}`)
    check(e.pubkey === r.pubkey, `${short(r.id)}: signed by ${short(e.pubkey)}, author is ${short(r.pubkey)}`)
    check(e.tags.some((t) => t[0] === 'h' && t[1] === s.channels.get(r.dm)), `${short(r.id)}: not in its DM channel`)
    if (r.rootId) {
      const root = copies.get(r.rootId)?.id ?? s.rows.find((x) => x.id === r.rootId)?.nostrEventId
      check(!!root && e.tags.some((t) => t[0] === 'e' && t[1] === root), `${short(r.id)}: not threaded under its root`)
    }
    const imeta = e.tags.filter((t) => t[0] === 'imeta')
    check(imeta.length === r.files.length, `${short(r.id)}: ${imeta.length} imeta for ${r.files.length} file(s)`)
    for (const t of imeta) {
      const url = t.find((p) => p.startsWith('url '))?.slice(4)
      const x = t.find((p) => p.startsWith('x '))?.slice(2)
      if (!url || !x) {
        fail.push(`${short(r.id)}: imeta without url/x`)
        continue
      }
      const back = await fetchBlob({ relayUrl: RELAY_URL, url, sign: reader.sign, pubkey: reader.pubkey }).catch((err: unknown) => err as Error)
      if (back instanceof Error) fail.push(`${short(r.id)}: ${url} → ${back.message}`)
      else if (sha256Of(back.bytes) !== x) fail.push(`${short(r.id)}: ${url} hashes to something else`)
      else blobsRead++
    }
  }
  for (const x of reactions) {
    const e = copies.get(x.id)
    const target = copies.get(x.replyId ?? x.messageId)?.id
    check(!!e && e.pubkey === x.pubkey && e.content === x.emoji && e.tags.some((t) => t[0] === 'e' && t[1] === target), `reaction ${short(x.id)}: missing or on the wrong copy`)
  }
  for (const a of assertions) {
    const e = copies.get(a.id)
    check(!!e && e.pubkey === a.pubkey && e.tags.some((t) => t[0] === 'e' && t[1] === copies.get(a.messageId)?.id), `resolution ${short(a.id)}: missing or on the wrong copy`)
  }
  console.log(`as ${short(reader.pubkey)}…: ${rows.filter((r) => copies.has(r.id)).length}/${rows.length} rows, ${reactions.filter((x) => copies.has(x.id)).length}/${reactions.length} reactions, ${assertions.filter((a) => copies.has(a.id)).length}/${assertions.length} resolutions, ${blobsRead}/${rows.reduce((n, r) => n + r.files.length, 0)} blobs read back`)
  for (const f of fail.slice(0, 30)) console.log(`  ✗ ${f}`)
  console.log(fail.length ? `\n${fail.length} failure(s)` : `\nevery Convex-only DM row is on the relay with its true date and author, threaded, with its files, reactions and resolution.`)
  console.log(`The Convex half is the census on a fresh snapshot — writeback prints the command.`)
  process.exitCode = fail.length ? 1 : 0
}

// ── entry ───────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2] ?? 'plan'
  if (mode === 'writeback') return writeback()
  const zip = argValue('--snapshot')
  if (!zip) throw new Error('--snapshot <convex export zip, with storage> is required')
  const s = readSnapshot(zip)
  if (mode === 'plan') return plan(s)
  if (mode === 'migrate') return migrate(s)
  if (mode === 'verify') return verify(s)
  throw new Error(`unknown mode "${mode}" — plan | migrate | writeback | verify`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
