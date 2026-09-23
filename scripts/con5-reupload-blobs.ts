/**
 * Copy the attachments that exist only in Convex `_storage` into the relay's
 * blob store — CON-5, the bytes leg.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/con5-reupload-blobs.ts            # plan: read-only
 *   npx tsx --tsconfig tsconfig.app.json scripts/con5-reupload-blobs.ts --apply    # upload
 *
 * ## Why bytes first, and nothing else
 *
 * An `imeta` cannot describe a blob that is not in the blob store — ingest runs
 * `verify_imeta_blobs` and refuses the event — and these bytes exist in exactly
 * one place that ordinary use is deleting (two lost between 09-17 and 09-22).
 * So this run only *copies*. It writes no event, touches no Convex row and
 * deletes nothing. Putting the `imeta` on each message is a separate step that
 * waits on an RFC change: RFC 0.4 §7.2.1 has a `kind:40003` replace the body
 * only, and every reader follows it (Ship's `foldAttachments`, Peek's
 * `applyEdit`).
 *
 * What that later step needs is written to {@link MANIFEST}: one line per file,
 * naming the Convex row and message event it belongs to and the relay's
 * descriptor for the uploaded copy. `m`, `x`, `dim` and `thumb` must be the
 * relay's answers, not ours, so the descriptor is kept whole.
 *
 * ## Which files
 *
 * The census's population (`probe-shr8-census.ts`): every topic and huddle
 * row whose file is not described by an `imeta` on the row's relay event,
 * minus the topics CON-4 discarded. A file is matched to an `imeta` by
 * filename; an event whose `imeta`s carry no filename falls back to the
 * census's count rule. Over-including is harmless — a blob is
 * content-addressed, so a second upload of the same bytes is the same blob.
 *
 * ## What counts as done, per file
 *
 * Not the upload's 200. The blob is fetched back with a fresh authorization
 * and its hash compared to the descriptor's `sha256`; only then does the file
 * go into the manifest. A re-run skips what the manifest already holds, so an
 * interrupted run resumes rather than repeats.
 *
 * Needs `kind:24242` in the credential's ceiling (hop 0) for `--apply`; the plan
 * needs only the ceiling the census does.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { authorizationHeaderFor, buildUnsignedAuthEvent, fetchBlob, sha256Of, uploadBlob } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent, UploadedBlob } from '@estiva-app/protocol'
import { DISCARDED } from './con4-discarded.js'
import { sanitizeForRelay } from './con5-sanitize-media.js'

const CONVEX = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'
const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
/** JSON lines, appended one verified file at a time. Outside the repo: it names production rows. */
const MANIFEST = process.env.CON5_MANIFEST ?? `${homedir()}/con5-manifest.jsonl`

const BLOB_AUTH_KIND = 24242

const args = process.argv.slice(2)
for (const a of args) if (a !== '--apply') throw new Error(`unknown argument ${a} — the only one is --apply`)
const APPLY = args.includes('--apply')

interface Token {
  accessToken: string
  pubkey: string
  allowedKinds: number[]
}

async function token(): Promise<Token> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grantType: 'client_credentials', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string; allowed_kinds?: number[] }
  return { accessToken: body.access_token, pubkey: body.pubkey, allowedKinds: body.allowed_kinds ?? [] }
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

async function queryRelay(filters: Record<string, unknown>[], t: Token): Promise<SignedEvent[]> {
  const url = `${RELAY_URL}/query`
  const body = JSON.stringify(filters)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  if (res.status !== 200) throw new Error(`/query: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as SignedEvent[]
}

async function convex<T>(path: string, a: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CONVEX}/api/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args: a, format: 'json' }),
  })
  const body = (await res.json()) as { status?: string; value?: unknown; errorMessage?: string }
  if (body.status === 'error') throw new Error(`${path}: ${body.errorMessage}`)
  return (body.value ?? body) as T
}

/** A file as `resolveFileAttachments` returns it. `url` is present only for a Convex-stored one. */
type RowFile = { name: string; contentType: string; size: number; storageId?: string; url?: string; mediaUrl?: string }
type Row = { id: string; files?: RowFile[]; nostrEventId?: string | null }

interface Candidate {
  surface: string
  rowKind: 'root' | 'reply'
  rowId: string
  eventId: string | null
  file: RowFile
}

interface ManifestLine {
  surface: string
  rowKind: 'root' | 'reply'
  rowId: string
  eventId: string | null
  storageId: string
  name: string
  contentType: string
  size: number
  blob: UploadedBlob
  verifiedAt: string
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** Every file on every non-DM row, with the row's event id. */
async function collect(): Promise<Candidate[]> {
  const out: Candidate[] = []
  const surfaces: Array<[string, 'topic' | 'huddle', string]> = []
  for (const t of await convex<Array<{ title: string; id: string }>>('topics:list', {})) {
    if (DISCARDED[t.title]) continue
    surfaces.push([`topic/${t.title}`, 'topic', t.id])
  }
  for (const h of await convex<Array<{ title?: string; name?: string; id: string }>>('huddles:list', {})) {
    surfaces.push([`huddle/${h.title ?? h.name ?? h.id}`, 'huddle', h.id])
  }
  for (const [surface, parentKind, parentKey] of surfaces) {
    const page = await convex<{ rows: Row[] }>('messages:list', { parentKind, parentKey })
    for (const m of page.rows) {
      for (const file of m.files ?? []) out.push({ surface, rowKind: 'root', rowId: m.id, eventId: m.nostrEventId ?? null, file })
      for (const r of await convex<Row[]>('replies:list', { messageKey: m.id })) {
        for (const file of r.files ?? []) out.push({ surface, rowKind: 'reply', rowId: r.id, eventId: r.nostrEventId ?? null, file })
      }
    }
  }
  return out
}

/** The files whose row's event carries no `imeta` for them — the census's gap, per file. */
async function undescribed(all: Candidate[], t: Token): Promise<Candidate[]> {
  const ids = [...new Set(all.map((c) => c.eventId).filter((x): x is string => !!x))]
  const events = new Map<string, SignedEvent>()
  for (const post of chunk(chunk(ids, 100).map((batch) => ({ ids: batch, limit: batch.length })), 20)) {
    for (const e of await queryRelay(post, t)) events.set(e.id, e)
  }
  const byRow = new Map<string, Candidate[]>()
  for (const c of all) byRow.set(c.rowId, [...(byRow.get(c.rowId) ?? []), c])

  const out: Candidate[] = []
  for (const files of byRow.values()) {
    const e = files[0].eventId ? events.get(files[0].eventId) : undefined
    const imetas = e?.tags.filter((tag) => tag[0] === 'imeta') ?? []
    const named = new Set(imetas.flatMap((tag) => tag.slice(1).filter((p) => p.startsWith('filename ')).map((p) => p.slice(9))))
    files.forEach((c, i) => {
      const described = named.size > 0 ? named.has(c.file.name) : i < imetas.length
      if (!described) out.push(c)
    })
  }
  return out
}

function readManifest(): Map<string, ManifestLine> {
  const done = new Map<string, ManifestLine>()
  if (!existsSync(MANIFEST)) return done
  for (const line of readFileSync(MANIFEST, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const m = JSON.parse(line) as ManifestLine
    done.set(`${m.rowId}:${m.storageId}`, m)
  }
  return done
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are required')
  const t = await token()
  // Hop 0: without it `/sign` refuses in words that read like the relay refusing the blob.
  const mayUpload = t.allowedKinds.includes(BLOB_AUTH_KIND)
  console.log(`identity ${t.pubkey.slice(0, 8)}… — kind:${BLOB_AUTH_KIND} ${mayUpload ? 'in' : 'NOT in'} the ceiling`)
  if (APPLY && !mayUpload) throw new Error(`--apply needs kind:${BLOB_AUTH_KIND}; the ceiling is [${t.allowedKinds.join(',')}]`)

  const all = await collect()
  const gap = await undescribed(all, t)
  const done = readManifest()
  console.log(`files on non-DM rows: ${all.length}; with no imeta on their event: ${gap.length}; already in ${MANIFEST}: ${done.size}\n`)

  let copied = 0
  let lost = 0
  let failed = 0
  let skipped = 0
  for (const c of gap) {
    const label = `${c.surface.slice(0, 32).padEnd(32)} ${c.rowKind.padEnd(5)} ${c.file.name.slice(0, 40)}`
    // A relay-hosted file with no `imeta` is CON-12's gap, not this one: its bytes are already in the blob store.
    if (!c.file.storageId) {
      console.log(`·  ${label} — not in Convex storage (${c.file.mediaUrl ?? 'no url'}); nothing to copy`)
      skipped++
      continue
    }
    if (done.has(`${c.rowId}:${c.file.storageId}`)) {
      skipped++
      continue
    }
    if (!c.file.url) {
      // `resolveFileAttachments` drops a file whose blob has vanished, so this should not appear — but if it does, it is a loss.
      console.log(`✗  ${label} — Convex has no URL for storage ${c.file.storageId}: the bytes are gone`)
      lost++
      continue
    }
    try {
      const res = await fetch(c.file.url)
      if (!res.ok) throw new Error(`Convex storage GET ${res.status}`)
      const bytes = await res.arrayBuffer()
      if (bytes.byteLength !== c.file.size) throw new Error(`Convex returned ${bytes.byteLength} bytes, the row says ${c.file.size}`)
      if (!APPLY) {
        console.log(`○  ${label} — ${bytes.byteLength} bytes readable, sha256 ${sha256Of(bytes).slice(0, 12)}…`)
        continue
      }

      const signer = (unsigned: UnsignedEvent) => sign(unsigned, t.accessToken)
      const blob = await uploadBlob({
        relayUrl: RELAY_URL,
        // Three of the 62 were refused as-is (a udta, a trailing moov, an ICC profile).
        bytes: sanitizeForRelay(bytes, c.file.contentType),
        contentType: c.file.contentType || undefined,
        filename: c.file.name,
        sign: signer,
        pubkey: t.pubkey,
      })
      // Read it back: the upload's 200 is the mechanism, the bytes are the claim.
      const back = await fetchBlob({ relayUrl: RELAY_URL, url: blob.url, sign: signer, pubkey: t.pubkey })
      const got = sha256Of(back.bytes)
      if (got !== blob.sha256) throw new Error(`read back ${got}, descriptor says ${blob.sha256}`)

      const line: ManifestLine = {
        surface: c.surface,
        rowKind: c.rowKind,
        rowId: c.rowId,
        eventId: c.eventId,
        storageId: c.file.storageId,
        name: c.file.name,
        contentType: c.file.contentType,
        size: c.file.size,
        blob,
        verifiedAt: new Date().toISOString(),
      }
      appendFileSync(MANIFEST, JSON.stringify(line) + '\n', { mode: 0o600 })
      console.log(`✓  ${label} — ${blob.url} (${blob.type}, ${blob.size} bytes, read back)`)
      copied++
    } catch (e) {
      console.log(`✗  ${label} — ${e instanceof Error ? e.message : String(e)}`)
      failed++
    }
  }

  console.log(
    `\n${APPLY ? 'copied and read back' : 'plan only — nothing uploaded'}: ${copied}; already done / not in Convex: ${skipped}; ` +
      `gone from Convex: ${lost}; failed: ${failed}`,
  )
  if (lost || failed) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
