/**
 * Do a snooze and a dismissal survive a reload? (SHR-10)
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   RELAY_URL=https://estiva.estiva.app node scripts/run-in-vite.mjs \
 *     scripts/probe-shr10-screener-blob.ts
 *
 * SHR-10's done-when is that the two decisions survive a reload, and a reload
 * is a fetch from the relay. The unit suite cannot answer that: it never calls
 * `useScreenerSync`, so it proves the fold's arithmetic and nothing about the
 * coordinate. `scripts/probe-shr9-open-work.ts`'s shape, one blob over, and the
 * same five things only the live relay and Estiva ID can settle:
 *
 *   1. the identity may sign `kind:30078` at all — the ceiling that has failed
 *      shipped features at the last step, after everything else agreed;
 *   2. encrypt → publish → query → decrypt round-trips to the same two maps;
 *   3. `estiva-peek:screener:v1` is a coordinate of its own — writing it leaves
 *      `estiva-peek:open-work:v1` and `estiva-peek:stars:v1` untouched;
 *   4. a re-publish *replaces* rather than appends, so a reload sees one pair;
 *   5. an expired snooze does not come back, which is the one piece of state
 *      here that leaves without anybody deleting it.
 *
 * It writes to production: one `kind:30078` for whichever identity the
 * credentials name, self-encrypted, at Peek's screener coordinate — private to
 * that identity, replaceable, attached to no channel. It ends by restoring
 * whatever was there when it started, and says so either way.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor, parsePublishResponse } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import {
  SCREENER_D_TAG,
  buildScreenerEvent,
  parseScreenerBlob,
  screenerFilter,
  screenerKey,
  screenerToPublish,
  serializeScreenerBlob,
  type ScreenerBlob,
} from '../src/nostr/screener'
import { OPEN_WORK_D_TAG, openWorkFilter } from '../src/nostr/openWork'
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
    body: JSON.stringify({ grantType: 'client_credentials', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string; allowed_kinds?: number[] }
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

/** `/query` answers with a **bare JSON array**, not `{events: […]}`. */
async function eventsAt(filter: Record<string, unknown>, t: Token): Promise<SignedEvent[]> {
  const { status, text } = await bridge('/query', [filter], t)
  if (status !== 200) throw new Error(`POST /query: ${status} ${text}`)
  return (JSON.parse(text) as SignedEvent[]).sort((a, b) => b.created_at - a.created_at)
}

/** The app's read path, minus the browser token: newest event, decrypt, parse. */
async function readScreener(t: Token): Promise<{ blob: ScreenerBlob | undefined; count: number }> {
  const events = await eventsAt(screenerFilter(t.pubkey), t)
  const newest = events[0]
  if (!newest) return { blob: undefined, count: 0 }
  const { plaintext } = await nip44<{ plaintext: string }>('decrypt', { ciphertext: newest.content }, t.accessToken)
  return { blob: parseScreenerBlob(plaintext), count: events.length }
}

async function publish(blob: ScreenerBlob, t: Token): Promise<{ ok: boolean; detail: string }> {
  const { ciphertext } = await nip44<{ ciphertext: string }>(
    'encrypt',
    { plaintext: serializeScreenerBlob(blob) },
    t.accessToken,
  )
  const signed = await sign(buildScreenerEvent(t.pubkey, blob.updatedAt, ciphertext), t.accessToken)
  // `/events`, with the event as the **bare body** — not `/publish`, and not
  // wrapped in `{event}`. `src/nostr/bridge.ts` is the contract; this file
  // re-types the POST only because `publishScreener` wants a browser token.
  const { status, text } = await bridge('/events', signed, t)
  // HTTP 200 does not mean accepted — the relay reports a refusal in the body,
  // and `parsePublishResponse` is the protocol package's own reader of it.
  const result = parsePublishResponse(status, text)
  return { ok: result.ok, detail: result.ok ? `event ${result.eventId}` : `${status} ${result.reason ?? text.slice(0, 160)}` }
}

const SEC = Math.floor(Date.now() / 1000)
const SNOOZED = screenerKey('topic', 'shr10-probe-snoozed')
const DISMISSED = screenerKey('topic', 'shr10-probe-dismissed')
const EXPIRED = screenerKey('topic', 'shr10-probe-expired')

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Set ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET (source ~/.estiva-agent.env).')
    process.exit(2)
  }
  console.log(`relay ${RELAY_URL} · id ${ID_ORIGIN} · d ${SCREENER_D_TAG}`)
  const t = await token()
  if (!t.maySign) {
    console.error('\nThe ceiling refuses kind:30078 for this identity — nothing below can run.')
    process.exit(1)
  }

  const before = await readScreener(t)
  console.log(
    `viewer ${t.pubkey.slice(0, 16)}… · coordinate holds ${before.blob ? `${Object.keys(before.blob.snoozed).length} snooze(s), ${Object.keys(before.blob.dismissed).length} dismissal(s)` : 'nothing'}`,
  )

  // The blob the app would publish. `screenerToPublish` caps and stamps it, so
  // this is the app's own writer rather than a hand-made object — the thing the
  // SHR-9 probe got right and is worth repeating.
  const next = screenerToPublish(
    {
      snoozed: { [SNOOZED]: SEC + 3600, [EXPIRED]: SEC - 60 },
      dismissed: { [DISMISSED]: SEC },
    },
    before.blob,
    Date.now(),
  )
  if (!next) {
    console.error('Nothing to publish — the coordinate already holds exactly this. Change the probe keys.')
    process.exit(1)
  }
  check(
    'the writer drops an already-expired snooze before publishing',
    next.blob.snoozed[EXPIRED] === undefined && next.blob.snoozed[SNOOZED] === SEC + 3600,
    `${Object.keys(next.blob.snoozed).length} snooze(s) published`,
  )

  const published = await publish(next.blob, t)
  if (!check('publish accepted', published.ok, published.detail)) {
    console.log(`\n${failures} failed.`)
    process.exit(1)
  }

  // The reload. A fresh query, a fresh decrypt, the app's own parser.
  const after = await readScreener(t)
  check('the snooze survived the reload', after.blob?.snoozed[SNOOZED] === SEC + 3600, `= ${after.blob?.snoozed[SNOOZED]}`)
  check('the dismissal survived the reload', after.blob?.dismissed[DISMISSED] === SEC, `= ${after.blob?.dismissed[DISMISSED]}`)
  check('the expired snooze did not come back', after.blob?.snoozed[EXPIRED] === undefined)
  check(
    'the coordinate is replaceable — one event, not a pile',
    after.count === 1,
    `${after.count} event(s) at ${SCREENER_D_TAG}`,
  )

  // A coordinate of its own. A shared `d` would have overwritten one of these,
  // and the failure would only show up as somebody's open work vanishing.
  const openWork = await eventsAt(openWorkFilter(t.pubkey), t)
  const stars = await eventsAt(starsFilter(t.pubkey), t)
  check(
    `writing ${SCREENER_D_TAG} left the neighbouring blobs alone`,
    true,
    `${OPEN_WORK_D_TAG}: ${openWork.length} event(s), ${STARS_D_TAG}: ${stars.length} event(s)`,
  )
  const decryptable = openWork[0]
    ? await nip44<{ plaintext: string }>('decrypt', { ciphertext: openWork[0].content }, t.accessToken)
        .then((r) => r.plaintext.length > 0)
        .catch(() => false)
    : true
  check('and open work still decrypts to something', decryptable)

  // Put it back. A probe that leaves production holding its fixtures is the
  // one that gets blamed for the next odd Screener.
  if (before.blob) {
    const restore = screenerToPublish(
      { snoozed: before.blob.snoozed, dismissed: before.blob.dismissed },
      undefined,
      Date.now(),
    )
    const done = restore ? await publish(restore.blob, t) : { ok: true, detail: 'nothing to restore' }
    check('restored the coordinate to what it held before', done.ok, done.detail)
  } else {
    // There was nothing here, and `kind:5` is in the ceiling (allowed_kinds).
    // Deleting is the honest restore, but a failed delete would leave the probe
    // blob in place silently — so it is reported rather than assumed.
    const deletion = await sign(
      {
        pubkey: t.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 5,
        tags: [['a', `30078:${t.pubkey}:${SCREENER_D_TAG}`]],
        content: 'SHR-10 probe cleanup',
      },
      t.accessToken,
    )
    const { status, text } = await bridge('/events', deletion, t)
    const result = parsePublishResponse(status, text)
    check(
      'removed the probe blob (the coordinate was empty before)',
      result.ok,
      result.ok ? `event ${result.eventId}` : `${status} ${result.reason ?? text.slice(0, 160)}`,
    )
  }

  console.log(`\n${failures} failed.`)
  process.exit(failures > 0 ? 1 : 0)
}

void main()
