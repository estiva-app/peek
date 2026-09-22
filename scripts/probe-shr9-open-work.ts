/**
 * Publish an open-work blob and read it back (SHR-9).
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   RELAY_URL=https://estiva.estiva.app npx tsx scripts/probe-shr9-open-work.ts
 *
 * SHR-9's done-when is "an entry survives a reload", and a reload is a fetch
 * from the relay. A green unit suite cannot answer that: it mocks
 * `useOpenWorkSync`, so it proves the provider's arithmetic and nothing about
 * the coordinate. Four things are only answerable against the live relay and
 * Estiva ID:
 *
 *   1. the identity may sign `kind:30078` at all — the ceiling that has failed
 *      three shipped features at the last step, after everything else agreed;
 *   2. `/nip44/encrypt` → publish → `/query` → `/nip44/decrypt` round-trips to
 *      the same entries, **in the same order**, which is the half of this blob
 *      that has no equivalent in `stars`;
 *   3. `estiva-peek:open-work:v1` is a coordinate of its own — writing it leaves
 *      `estiva-peek:stars:v1` untouched, which a shared `d` would not;
 *   4. a re-publish *replaces* rather than appends, so a reload sees one list.
 *
 * The blob shape comes from `src/nostr/openWork.ts` — the app's own functions,
 * not a re-typed copy. Only the HTTP seam is local, because `publishOpenWork`
 * reaches for a browser token this process does not have.
 *
 * It writes to production. What it writes is one `kind:30078` for whichever
 * identity the credentials name, self-encrypted, at Peek's open-work
 * coordinate — private to that identity, replaceable, attached to no channel.
 * It ends by restoring whatever was there when it started.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor, parsePublishResponse } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import {
  OPEN_WORK_D_TAG,
  buildOpenWorkEvent,
  openWorkFilter,
  openWorkToPublish,
  parseOpenWorkBlob,
  serializeOpenWorkBlob,
  type OpenWorkBlob,
  type OpenWorkRef,
} from '../src/nostr/openWork'
import { STARS_D_TAG, starsFilter } from '../src/nostr/stars'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

let failures = 0
function check(label: string, ok: boolean, detail = ''): boolean {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
  return ok
}

interface Token {
  accessToken: string
  pubkey: string
}

async function token(): Promise<Token & { maySign: boolean }> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // camelCase — Estiva ID's /token is not an OAuth-shaped snake_case body,
    // and a snake_case one comes back "401 No session cookie", which reads as a
    // credential problem rather than a schema one.
    body: JSON.stringify({ grantType: 'client_credentials', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string; allowed_kinds?: number[] }
  // `/token` returns the live ceiling, which reads it without touching the box.
  const maySign = (body.allowed_kinds ?? []).includes(30078)
  check('identity may sign kind:30078', maySign, `allowed_kinds = ${JSON.stringify(body.allowed_kinds ?? [])}`)
  return { accessToken: body.access_token, pubkey: body.pubkey, maySign }
}

async function nip44<T>(op: 'encrypt' | 'decrypt', body: object, accessToken: string): Promise<T> {
  const res = await fetch(`${ID_ORIGIN}/nip44/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST /nip44/${op}: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
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

async function bridge(path: string, payload: unknown, t: Token) {
  const url = `${RELAY_URL.replace(/\/+$/, '')}${path}`
  const body = JSON.stringify(payload)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  return { status: res.status, text: await res.text() }
}

/** Every event at a coordinate, newest first. `/query` answers with a **bare
 *  JSON array**, not `{events: […]}` — reading `.events` off it yields undefined
 *  and an empty result, which looks exactly like "the coordinate is empty". */
async function eventsAt(filter: Record<string, unknown>, t: Token): Promise<SignedEvent[]> {
  const { status, text } = await bridge('/query', [filter], t)
  if (status !== 200) throw new Error(`POST /query: ${status} ${text}`)
  return (JSON.parse(text) as SignedEvent[]).sort((a, b) => b.created_at - a.created_at)
}

/** The app's read path, minus the browser token: newest event, decrypt, parse. */
async function readOpenWork(t: Token): Promise<{ blob: OpenWorkBlob | undefined; count: number }> {
  const events = await eventsAt(openWorkFilter(t.pubkey), t)
  const newest = events[0]
  if (!newest) return { blob: undefined, count: 0 }
  const { plaintext } = await nip44<{ plaintext: string }>('decrypt', { ciphertext: newest.content }, t.accessToken)
  return { blob: parseOpenWorkBlob(plaintext), count: events.length }
}

async function publish(blob: OpenWorkBlob, t: Token): Promise<{ ok: boolean; detail: string }> {
  const { ciphertext } = await nip44<{ ciphertext: string }>(
    'encrypt',
    { plaintext: serializeOpenWorkBlob(blob) },
    t.accessToken,
  )
  const signed = await sign(buildOpenWorkEvent(t.pubkey, blob.updatedAt, ciphertext), t.accessToken)
  // `/events`, with the event as the **bare body** — not `/publish`, and not
  // wrapped in `{event}`. Both of those were wrong in the first run of this
  // probe and both answered 404, which reads exactly like the relay refusing
  // the coordinate. `src/nostr/bridge.ts` is the contract; the only reason this
  // file re-types the POST at all is the browser token `publishSigned` wants.
  const { status, text } = await bridge('/events', signed, t)
  // HTTP 200 does not mean accepted — the relay reports a refusal in the body.
  // `parsePublishResponse` is the protocol package's own reader of that, and a
  // hand-rolled check of it is the other half of the same mistake.
  const result = parsePublishResponse(status, text)
  return { ok: result.ok, detail: result.ok ? `event ${result.eventId}` : `${status} ${result.reason ?? text.slice(0, 160)}` }
}

const ENTRIES: OpenWorkRef[] = [
  { kind: 'topic', id: 'shr9-probe-topic-a', channelUuid: 'f1e2d3c4-b5a6-4978-8b1c-2d3e4f5a6b7c' },
  { kind: 'dm', key: 'shr9-probe-person' },
  { kind: 'topic', id: 'shr9-probe-topic-b' },
]

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('set ESTIVA_ID_CLIENT_ID and ESTIVA_ID_CLIENT_SECRET (see ~/.estiva-agent.env)')
    process.exit(2)
  }
  const t = await token()
  if (!t.maySign) {
    console.error('the ceiling refuses kind:30078; nothing below can run')
    process.exit(1)
  }

  console.log(`\nrelay ${RELAY_URL}\npubkey ${t.pubkey}\nd ${OPEN_WORK_D_TAG}\n`)

  // What is there now, so the run can put it back. A person's real open work
  // lives at this coordinate for this identity.
  const before = await readOpenWork(t)
  console.log(`existing blob: ${before.blob ? `${before.blob.entries.length} entr(ies)` : 'none'}\n`)

  // ── The round trip, in order ──────────────────────────────────────────────
  const first = openWorkToPublish(ENTRIES, before.blob, Date.now())
  if (!first) throw new Error('openWorkToPublish said nothing changed against a list it cannot equal')
  const wrote = await publish(first, t)
  check('the relay accepted the open-work blob', wrote.ok, wrote.detail)

  const read = await readOpenWork(t)
  check('the blob comes back from the coordinate', read.blob !== undefined)
  check(
    'entries survive the round trip in the order they were written',
    JSON.stringify(read.blob?.entries) === JSON.stringify(ENTRIES),
    JSON.stringify(read.blob?.entries),
  )
  check(
    'a DM entry survives, which is the half SHR-6 could not carry',
    read.blob?.entries.some((e) => e.kind === 'dm' && e.key === 'shr9-probe-person') === true,
  )
  const writtenUuid = ENTRIES[0].kind === 'topic' ? ENTRIES[0].channelUuid : undefined
  check(
    'the relay identity travels beside the app-local id',
    read.blob?.entries.some((e) => e.kind === 'topic' && e.channelUuid === writtenUuid) === true,
    `channelUuid = ${writtenUuid}`,
  )

  // ── Appending, the way the provider does ──────────────────────────────────
  const appended: OpenWorkRef[] = [...ENTRIES, { kind: 'topic', id: 'shr9-probe-topic-c' }]
  const second = openWorkToPublish(appended, read.blob, Date.now() + 1000)
  if (!second) throw new Error('openWorkToPublish called an appended list unchanged')
  const wroteAgain = await publish(second, t)
  check('the relay accepted the appended list', wroteAgain.ok, wroteAgain.detail)

  const reread = await readOpenWork(t)
  check(
    'new work is last, and the earlier entries have not moved',
    JSON.stringify(reread.blob?.entries) === JSON.stringify(appended),
    JSON.stringify(reread.blob?.entries?.map((e) => (e.kind === 'dm' ? e.key : e.kind === 'file' ? e.address : e.id))),
  )
  check(
    'a re-publish replaces the coordinate rather than adding to it',
    reread.count === 1,
    `${reread.count} event(s) at the coordinate`,
  )

  // ── The negative control ──────────────────────────────────────────────────
  // Without this, "the blob is at open-work:v1" is indistinguishable from "the
  // blob is at some kind:30078 and the filter is loose". Stars share the kind,
  // the author and the `t` tag, and differ only in `d`.
  const stars = await eventsAt(starsFilter(t.pubkey), t)
  const starsD = stars[0]?.tags.find(([name]) => name === 'd')?.[1]
  check(
    'the open-work blob did not land on the stars coordinate',
    stars.length === 0 || starsD === STARS_D_TAG,
    `stars d = ${starsD ?? 'no stars blob for this identity'}`,
  )
  const openD = (await eventsAt(openWorkFilter(t.pubkey), t))[0]?.tags.find(([name]) => name === 'd')?.[1]
  check('and it is at the open-work coordinate', openD === OPEN_WORK_D_TAG, `d = ${openD}`)
  check(
    'with no h tag, which SPEC §12.2 makes a MUST NOT',
    (await eventsAt(openWorkFilter(t.pubkey), t))[0]?.tags.every(([name]) => name !== 'h') === true,
  )

  // ── Put back what was there ───────────────────────────────────────────────
  // The coordinate is replaceable, so restoring is one more publish. An
  // identity that had no blob keeps one holding an empty list, which reads the
  // same as none for every caller.
  const restore = before.blob ?? { v: 1 as const, updatedAt: Date.now() + 2000, entries: [] }
  const putBack = await publish({ ...restore, updatedAt: Date.now() + 2000 }, t)
  check('the coordinate was restored to what it held before the run', putBack.ok, putBack.detail)

  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`)
  process.exit(failures === 0 ? 0 : 1)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
