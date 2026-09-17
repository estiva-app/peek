/**
 * What the Screener costs to load, before and after (SHR-10).
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   node scripts/run-in-vite.mjs scripts/measure-shr10-screener.ts
 *
 * FOL-18's and SHR-5's form: requests and milliseconds against production, not
 * a fixture. Read the caveat before quoting a number — one of the four legs
 * cannot be measured from here yet, and saying so is the point of writing this
 * down rather than estimating it.
 *
 * ## What each leg is, and what its number actually covers
 *
 * | Leg | Measured against | What the number is |
 * |---|---|---|
 * | `desk:screenerList` | production Convex | a real round trip; an **empty** result |
 * | `screener:candidates` | production Convex | the same — deployed 2026-09-17, still empty |
 * | the decisions blob | production relay | a real, authenticated round trip |
 * | the fold itself | in process | real, over a synthetic workspace |
 *
 * **Every viewer-scoped Convex query returns `[]` without an identity**
 * (`viewerId(ctx)` is the first line of each), and Convex only accepts a token
 * whose `aud` is `estiva-peek` (`convex/auth.config.ts`), which the agent
 * identity's is not. So the Convex numbers here are the request count and the
 * round-trip floor — the network, the dispatch, the websocket — and **not** the
 * per-row work.
 *
 * `candidates` is deployed now (2026-09-17), so this runs it rather than
 * printing that it cannot. **The gap that remains is the identity, not the
 * deploy**, and no amount of re-running this closes it: the per-row cost is
 * what the query does over one viewer's topics, messages and replies, and
 * nothing this script can authenticate as has any. That number lives in the
 * Convex dashboard's function log for `honorable-guineapig-592`, where a real
 * signed-in viewer's call is already timed and its row count already recorded.
 * Read it there rather than approximating it here.
 *
 * The relay leg is authenticated, because the blob is this identity's own. What
 * it is *not* is representative of a full blob: the agent identity has no
 * Screener decisions, so the coordinate answers `[]` and the number is the
 * round trip rather than the transfer. That is the right number for the common
 * case — most people's decisions blob is a few hundred bytes and the ceiling is
 * 65,535 — but it is a floor, and the line below says which it is.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { UnsignedEvent, SignedEvent } from '@estiva-app/protocol'
import { screenerFilter } from '@/nostr/screener'
import { foldScreenerRows, type ScreenerCandidateContainer } from '@/api/internal/screenerFold'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CONVEX_URL = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

const SAMPLES = 12

/** Median, not mean: one GC pause or one cold lambda should not move the number. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const fmt = (xs: number[]) =>
  `${median(xs).toFixed(0)} ms median (${Math.min(...xs).toFixed(0)}–${Math.max(...xs).toFixed(0)}, n=${xs.length})`

async function timeConvexQuery(path: string): Promise<number[]> {
  const times: number[] = []
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now()
    const res = await fetch(`${CONVEX_URL}/api/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, args: {}, format: 'json' }),
    })
    const body = (await res.json()) as { status: string }
    times.push(performance.now() - t0)
    if (body.status !== 'success') throw new Error(`${path}: ${JSON.stringify(body)}`)
  }
  return times
}

async function token(): Promise<{ accessToken: string; pubkey: string }> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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

/**
 * The blob read, timed the way the app pays for it.
 *
 * The NIP-98 signature is **excluded** from the number: in the browser the app
 * signs through Estiva ID too, but that call is on the same page and is timed
 * separately below, and folding it in would make the relay look slow for
 * something the identity service did.
 */
async function timeRelayRead(t: { accessToken: string; pubkey: string }): Promise<{
  query: number[]
  signing: number[]
  bytes: number
}> {
  const url = `${RELAY_URL.replace(/\/+$/, '')}/query`
  const body = JSON.stringify([screenerFilter(t.pubkey)])
  const query: number[] = []
  const signing: number[] = []
  let bytes = 0
  for (let i = 0; i < SAMPLES; i++) {
    const s0 = performance.now()
    const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
    signing.push(performance.now() - s0)

    const q0 = performance.now()
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
      body,
    })
    const text = await res.text()
    query.push(performance.now() - q0)
    bytes = text.length
    if (res.status !== 200) throw new Error(`POST /query: ${res.status} ${text.slice(0, 200)}`)
  }
  return { query, signing, bytes }
}

/**
 * The fold, over a workspace bigger than production's.
 *
 * Production holds 175 topic messages; this is 200 containers of 20 events,
 * which is 4,000. If the device-side work were the cost anybody should worry
 * about, it would show at that size — and the point of measuring it is that the
 * thing SHR-7 §5 flagged as "the real cost, stated once" is compute-on-load
 * replacing compute-on-write.
 */
function timeFold(): { ms: number[]; containers: number; events: number } {
  const containers: ScreenerCandidateContainer[] = []
  const titles = new Map<string, string>()
  for (let c = 0; c < 200; c++) {
    const targetId = `topic-${c}`
    titles.set(targetId, `Topic ${c}`)
    const events = []
    for (let e = 0; e < 20; e++) {
      events.push({
        id: `m-${c}-${e}`,
        preview: 'x'.repeat(240),
        createdAt: 1_700_000_000_000 - e * 1000,
        isReply: e % 3 === 0,
        mentionsMe: e === 19 && c % 5 === 0,
        iWroteInThread: c % 7 === 0,
      })
    }
    containers.push({ kind: 'topic', targetId, isMember: c % 2 === 0, everOpened: c % 3 === 0, events })
  }
  const held = new Set(['topic-4', 'topic-8'])
  const decisions = { snoozed: {}, dismissed: {} }
  const ms: number[] = []
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now()
    foldScreenerRows(containers, decisions, held, (id) => titles.get(id), Date.now())
    ms.push(performance.now() - t0)
  }
  return { ms, containers: containers.length, events: containers.length * 20 }
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Set ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET (source ~/.estiva-agent.env).')
    process.exit(2)
  }
  console.log(`convex ${CONVEX_URL}\nrelay  ${RELAY_URL}\n`)

  console.log('── BEFORE: one Convex query per Desk load ──────────────')
  const listBefore = await timeConvexQuery('desk:screenerList')
  console.log(`  desk:screenerList          ${fmt(listBefore)}`)
  console.log('  requests: 1 Convex query, 0 relay\n')

  console.log('── AFTER: two Convex queries + one relay read ──────────')
  const listAfter = await timeConvexQuery('desk:screenerList')
  console.log(`  desk:screenerList (DMs)    ${fmt(listAfter)}`)
  const candidatesAfter = await timeConvexQuery('screener:candidates')
  console.log(`  screener:candidates        ${fmt(candidatesAfter)}`)
  const t = await token()
  const relay = await timeRelayRead(t)
  console.log(
    `  relay /query (the blob)    ${fmt(relay.query)}, ${relay.bytes} bytes` +
      (relay.bytes <= 2 ? ' — an EMPTY coordinate: this is the round trip, not a transfer' : ''),
  )
  console.log(`  …its NIP-98 signature      ${fmt(relay.signing)} (Estiva ID, not the relay)`)
  console.log('  requests: 2 Convex queries, 1 relay POST (+1 Convex on the first-run seed only)\n')

  console.log('── The fold itself, in process ─────────────────────────')
  const fold = timeFold()
  console.log(`  ${fold.containers} containers / ${fold.events} events   ${fmt(fold.ms)}`)
  console.log('  production holds 175 topic messages, so this is ~23× that\n')

  console.log('── What left the write path ────────────────────────────')
  console.log('  Per topic message sent, `screenMessage` used to do:')
  console.log('    1 × collect users, then per user 1 × collect deskOpenWork,')
  console.log('    and per member 1 × readState unique — O(users × containers).')
  console.log('  It now returns on the first line for a topic: 0 reads, 0 writes.')
  console.log('  Same for every reply, via `screenReply`.')
}

void main()
