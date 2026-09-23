/**
 * Put the re-uploaded attachments on their messages — CON-5, the `imeta` leg.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/con5-publish-imeta-edits.ts           # plan: read-only
 *   CON5_KEYS=~/.keys.json npx tsx --tsconfig tsconfig.app.json \
 *     scripts/con5-publish-imeta-edits.ts --apply                                     # publish
 *
 * Reads `~/con5-manifest.jsonl` (written by `con5-reupload-blobs.ts`) and
 * publishes, for each message it names, one `kind:40003` that carries the
 * message's **current** body unchanged plus its full attachment set as `imeta`
 * — RFC 0.4 §7.2.1 as amended 2026-09-23 (estiva-docs#146):
 *
 *   - **The body is the current one, not the original.** An edit's content
 *     replaces the body, so a message edited since it was sent must be given
 *     its latest text back, or this would revert the edit. The fold is the
 *     RFC's: `ts` when it agrees with `created_at` to the second, then
 *     `created_at`, then id.
 *   - **Identical content**, so a reader implementing the amendment does not
 *     mark the message edited.
 *   - **The whole set.** An edit's `imeta` set *replaces* the message's, so a
 *     message that already describes some files carries those too.
 *
 * `validate_edit_ownership` accepts only the target's author, so each edit is
 * signed with its author's key from {@link KEYS} — a JSON map of pubkey to
 * secret hex, exported per `memory: exporting-a-custodied-signing-key`. Each
 * secret is checked to derive the pubkey it is filed under before anything is
 * signed. The keys never leave this process and nothing prints them.
 *
 * Idempotent: a message whose current set already names every manifest file is
 * skipped, so a re-run after a partial one publishes only what is missing.
 * Every published edit is read back from the relay before it counts.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  authorizationHeaderFor,
  buildEdit,
  buildUnsignedAuthEvent,
  imetaTag,
  parsePublishResponse,
  publicKeyFromSecret,
  signEvent,
} from '@estiva-app/protocol'
import type { NostrTag, SignedEvent, UnsignedEvent, UploadedBlob } from '@estiva-app/protocol'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const MANIFEST = process.env.CON5_MANIFEST ?? `${homedir()}/con5-manifest.jsonl`
const KEYS = process.env.CON5_KEYS ?? `${homedir()}/.keys.json`
const EDIT_KIND = 40003

const args = process.argv.slice(2)
for (const a of args) if (a !== '--apply') throw new Error(`unknown argument ${a} — the only one is --apply`)
const APPLY = args.includes('--apply')

interface ManifestLine {
  eventId: string | null
  name: string
  blob: UploadedBlob
}

type Signer = (u: UnsignedEvent) => Promise<SignedEvent>

async function agentSigner(): Promise<{ pubkey: string; sign: Signer }> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grantType: 'client_credentials', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const t = (await res.json()) as { access_token: string; pubkey: string }
  return {
    pubkey: t.pubkey,
    sign: async (unsigned) => {
      const r = await fetch(`${ID_ORIGIN}/sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${t.access_token}` },
        body: JSON.stringify({ event: unsigned }),
      })
      if (!r.ok) throw new Error(`POST /sign: ${r.status} ${await r.text()}`)
      return ((await r.json()) as { event: SignedEvent }).event
    },
  }
}

/** A NIP-98-authorised POST to the relay's bridge, authorised by whoever `sign` signs as. */
async function bridge(path: string, payload: unknown, pubkey: string, sign: Signer) {
  const url = `${RELAY_URL}${path}`
  const body = JSON.stringify(payload)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey, url, method: 'POST', body }))
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  return { status: res.status, text: await res.text() }
}

async function query(filters: Record<string, unknown>[], reader: { pubkey: string; sign: Signer }): Promise<SignedEvent[]> {
  const { status, text } = await bridge('/query', filters, reader.pubkey, reader.sign)
  if (status !== 200) throw new Error(`/query: ${status} ${text.slice(0, 200)}`)
  return JSON.parse(text) as SignedEvent[]
}

/** `ts` in ms, honoured only when it agrees with `created_at` to the second — RFC 0.4 §7.2.1. */
function orderKey(e: SignedEvent): number {
  const ts = Number(e.tags.find((t) => t[0] === 'ts')?.[1])
  return Number.isFinite(ts) && Math.floor(ts / 1000) === e.created_at ? ts : e.created_at * 1000
}
const newestFirst = (a: SignedEvent, b: SignedEvent) => orderKey(b) - orderKey(a) || (a.id < b.id ? 1 : -1)

const imetasOf = (e: SignedEvent): NostrTag[] => e.tags.filter((t) => t[0] === 'imeta')
const field = (tag: NostrTag, key: string) => tag.slice(1).find((p) => p.startsWith(`${key} `))?.slice(key.length + 1)

function loadKeys(): Map<string, string> {
  const keys = new Map<string, string>()
  if (!existsSync(KEYS)) return keys
  for (const [pk, sk] of Object.entries(JSON.parse(readFileSync(KEYS, 'utf8')) as Record<string, string>)) {
    if (publicKeyFromSecret(sk) !== pk) throw new Error(`${KEYS}: the secret filed under ${pk.slice(0, 8)}… derives a different pubkey`)
    keys.set(pk, sk)
  }
  return keys
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are required (reads go as the agent)')
  const reader = await agentSigner()
  const keys = loadKeys()

  const lines = readFileSync(MANIFEST, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as ManifestLine)
  const byEvent = new Map<string, ManifestLine[]>()
  for (const l of lines) {
    if (!l.eventId) throw new Error(`manifest row for ${l.name} has no event id`)
    byEvent.set(l.eventId, [...(byEvent.get(l.eventId) ?? []), l])
  }
  const ids = [...byEvent.keys()]
  const targets = new Map((await query([{ ids, limit: ids.length }], reader)).map((e) => [e.id, e]))
  const edits = await query([{ kinds: [EDIT_KIND], '#e': ids, limit: 5000 }], reader)

  const authors = new Set([...targets.values()].map((e) => e.pubkey))
  const missingKeys = [...authors].filter((pk) => !keys.has(pk))
  console.log(`${lines.length} files on ${ids.length} messages by ${authors.size} authors; relay returned ${targets.size} of them`)
  if (missingKeys.length) console.log(`no key in ${KEYS} for: ${missingKeys.join(', ')}`)
  if (APPLY && missingKeys.length) throw new Error('--apply needs a key for every author')
  console.log()

  let published = 0
  let skipped = 0
  let failed = 0
  for (const [id, files] of byEvent) {
    const target = targets.get(id)
    if (!target) {
      console.log(`✗  ${id.slice(0, 8)} — not on the relay`)
      failed++
      continue
    }
    const channel = target.tags.find((t) => t[0] === 'h')?.[1]
    if (!channel) {
      console.log(`✗  ${id.slice(0, 8)} — target has no h tag`)
      failed++
      continue
    }
    // Only the author's own edits count — the relay would have refused anyone else's, but a reader must not trust that.
    const own = edits.filter((e) => e.pubkey === target.pubkey && e.tags.some((t) => t[0] === 'e' && t[1] === id)).sort(newestFirst)
    const body = own[0]?.content ?? target.content
    const currentSet = own.find((e) => imetasOf(e).length > 0) ? imetasOf(own.find((e) => imetasOf(e).length > 0)!) : imetasOf(target)
    const have = new Set(currentSet.map((t) => field(t, 'x')))
    const haveNames = new Set(currentSet.map((t) => field(t, 'filename')))
    const add = files.filter((f) => !have.has(f.blob.sha256) && !haveNames.has(f.name))
    const label = `${id.slice(0, 8)} by ${target.pubkey.slice(0, 8)} kind:${target.kind}`
    if (add.length === 0) {
      console.log(`·  ${label} — already carries all ${files.length}`)
      skipped++
      continue
    }
    const tags = [
      ...currentSet,
      ...add.map((f) =>
        imetaTag({ url: f.blob.url, m: f.blob.type, x: f.blob.sha256, size: f.blob.size, dim: f.blob.dim, thumb: f.blob.thumb, filename: f.name }),
      ),
    ]
    const plan = `${currentSet.length} → ${tags.length} imeta, body from ${own[0] ? 'its latest edit' : 'the original'} (${body.length} chars)`
    if (!APPLY) {
      console.log(`○  ${label} — ${plan}`)
      continue
    }

    try {
      const sk = keys.get(target.pubkey)!
      const unsigned = buildEdit(target.pubkey, Date.now(), { channelUuid: channel, targetEventId: id, body })
      unsigned.tags.push(...tags)
      const signed = signEvent(unsigned, sk)
      const author: Signer = async (u) => signEvent(u, sk)
      const { status, text } = await bridge('/events', signed, target.pubkey, author)
      const result = parsePublishResponse(status, text)
      if (!result.ok) throw new Error(`refused: ${status} ${result.reason ?? text.slice(0, 200)}`)
      const back = await query([{ ids: [signed.id], limit: 1 }], reader)
      if (back.length !== 1 || imetasOf(back[0]).length !== tags.length) throw new Error(`published ${signed.id} but the relay does not return it with ${tags.length} imeta`)
      console.log(`✓  ${label} — ${plan}; edit ${signed.id.slice(0, 12)} read back`)
      published++
    } catch (e) {
      console.log(`✗  ${label} — ${e instanceof Error ? e.message : String(e)}`)
      failed++
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  console.log(`\n${APPLY ? 'published and read back' : 'plan only — nothing published'}: ${published}; already complete: ${skipped}; failed: ${failed}`)
  if (failed) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
