/**
 * Do the relay-native Screener inputs exist, and can this viewer read them? (SHR-10)
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   RELAY_URL=https://estiva.estiva.app npx tsx --tsconfig tsconfig.app.json \
 *     scripts/probe-shr10-screener-inputs.ts
 *
 * SHR-10's table of four relay-native inputs was **read out of buzz's source**
 * on `origin/nfb-demo-kinds` and never asked of a running relay. That is the
 * same gap that produced "built is not deployed": the branch is not the box,
 * and a `feed_types` arm that exists in `bridge.rs` proves nothing about what
 * `estiva.estiva.app` answers today. This probe asks it.
 *
 * Read-only. It publishes nothing and deletes nothing; every leg is a `/query`
 * or a WS `REQ`. Relay reads are quota'd, so it takes one pass and caches the
 * channel it found rather than re-asking per leg.
 *
 * The four claims, each with the line of SHR-10 it is checking:
 *
 *   1. "`kind:44100` member-added, relay-signed, `p` = target, `h` = channel …
 *      `#p:[self]` on `/query`. Another pubkey's returns 403."
 *   2. "a real server-side index … exposed as `/query`'s `feed_types:
 *      ['mentions']` … `/query` only. Capped at 100 rows."
 *   3. "`kind:39005` thread summary, `{reply_count, descendant_count,
 *      last_reply_at, participants}` … opt-in via `include_summaries` on a
 *      `top_level` filter", one `#h` per filter, `participants` capped at 10.
 *   4. "`39005` and `feed_types` are HTTP-bridge-only. The WS `REQ` path parses
 *      via `nostr::Filter` and silently drops unknown fields."
 *
 * A leg that cannot be *decided* prints `⚠` and is reported as unproven. That
 * is deliberate: the failure this probe exists to prevent is a design built on
 * a source-read, and swapping it for a design built on a probe that quietly
 * answered "no events" would be the same mistake with a green tick on it.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

/** buzz `KIND_MEMBER_ADDED`, `KIND_THREAD_SUMMARY`, `KIND_WINDOW_BOUNDS`. */
const KIND_MEMBER_ADDED = 44100
const KIND_THREAD_SUMMARY = 39005
const KIND_WINDOW_BOUNDS = 39006
const KIND_CHANNEL_MESSAGE = 9

let failures = 0
let unproven = 0
function check(label: string, ok: boolean, detail = ''): boolean {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
  return ok
}
function undecided(label: string, detail: string): void {
  console.log(`⚠  ${label} — UNPROVEN: ${detail}`)
  unproven++
}

interface Token {
  accessToken: string
  pubkey: string
  allowedKinds: number[]
}

async function token(): Promise<Token> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
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

/**
 * `/query` with a **bare JSON array** of filters, NIP-98 signed per request.
 *
 * Returns the status as well as the events: three of the four legs here turn on
 * a *refusal* (403 for another pubkey's `#p`, 400 for two `#h` under
 * `top_level`), and a helper that threw on non-200 would hide exactly the
 * answer being asked for.
 */
async function query(
  filters: Record<string, unknown>[],
  t: Token,
): Promise<{ status: number; events: SignedEvent[]; text: string }> {
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
  let events: SignedEvent[] = []
  try {
    events = JSON.parse(text) as SignedEvent[]
  } catch {
    return { status: res.status, events: [], text }
  }
  return { status: res.status, events, text }
}

const tagValue = (e: SignedEvent, name: string): string | undefined =>
  e.tags.find((tag) => tag[0] === name)?.[1]

/* ------------------------------------------------------------------ *
 * 1. kind:44100 member-added
 * ------------------------------------------------------------------ */

async function probeMemberAdded(t: Token): Promise<string[]> {
  console.log('\n— 1. kind:44100 member-added, by `#p` ——————————————')
  const mine = await query([{ kinds: [KIND_MEMBER_ADDED], '#p': [t.pubkey], limit: 20 }], t)
  if (mine.status !== 200) {
    undecided('44100 readable by `#p:[self]`', `/query answered ${mine.status} ${mine.text.slice(0, 120)}`)
    return []
  }
  const found = check(
    '44100 reachable on `/query` by `#p:[self]`',
    mine.events.length > 0,
    `${mine.events.length} event(s)`,
  )
  const channels: string[] = []
  if (found) {
    const signers = new Set(mine.events.map((e) => e.pubkey))
    // "Relay-signed" is the load-bearing half: if these were signed by whoever
    // did the adding, the set would be several pubkeys and none of them the
    // relay's. One signer that is not me is the shape the claim describes.
    check(
      '44100 is relay-signed (one signer, not the viewer)',
      signers.size === 1 && !signers.has(t.pubkey),
      `signer(s) ${[...signers].map((s) => s.slice(0, 8)).join(', ')}`,
    )
    check(
      'every 44100 carries `p` = the viewer and an `h` = a channel',
      mine.events.every((e) => tagValue(e, 'p') === t.pubkey && !!tagValue(e, 'h')),
      `${mine.events.filter((e) => tagValue(e, 'h')).length}/${mine.events.length} with an \`h\``,
    )
    for (const e of mine.events) {
      const h = tagValue(e, 'h')
      if (h && !channels.includes(h)) channels.push(h)
    }
    console.log(`   → ${channels.length} distinct channel(s) reachable this way`)
  }

  // Someone else's inbox. A pubkey that is *valid* but not the viewer: flipping
  // the first hex nibble keeps the length and the alphabet, so a refusal is the
  // `#p` gate rather than a parse error on a made-up string.
  const other = t.pubkey.startsWith('0') ? `1${t.pubkey.slice(1)}` : `0${t.pubkey.slice(1)}`
  const theirs = await query([{ kinds: [KIND_MEMBER_ADDED], '#p': [other], limit: 5 }], t)
  check(
    "another pubkey's `#p` is refused",
    theirs.status === 403,
    `status ${theirs.status}${theirs.status === 200 ? ` with ${theirs.events.length} event(s)` : ''}`,
  )
  return channels
}

/* ------------------------------------------------------------------ *
 * 2. feed_types: ['mentions']
 * ------------------------------------------------------------------ */

async function probeMentions(t: Token): Promise<void> {
  console.log('\n— 2. `/query` `feed_types: ["mentions"]` ——————————————')
  // Over the documented 100-row cap on purpose: the claim is that the relay
  // clamps, and a request at or under the cap cannot tell a clamp from a
  // workspace that simply has fewer mentions than that.
  const asked = 150
  const res = await query([{ kinds: [KIND_CHANNEL_MESSAGE], feed_types: ['mentions'], limit: asked }], t)
  if (res.status !== 200) {
    undecided('`feed_types: ["mentions"]` is served', `/query answered ${res.status} ${res.text.slice(0, 120)}`)
    return
  }
  check('`/query` accepts `feed_types: ["mentions"]`', true, `${res.events.length} event(s) for limit ${asked}`)
  if (res.events.length === 0) {
    undecided(
      'the mention index returns this viewer\'s mentions',
      'zero rows — the agent identity may simply never have been @mentioned; this cannot distinguish an empty index from a missing one',
    )
  } else {
    check(
      'mention rows are channel messages the viewer can read',
      res.events.every((e) => e.kind === KIND_CHANNEL_MESSAGE && !!tagValue(e, 'h')),
      `kinds ${[...new Set(res.events.map((e) => e.kind))].join(', ')}`,
    )
    // The cap is only *demonstrated* by a workspace that has more than 100.
    if (res.events.length >= 100) {
      check('capped at 100 rows', res.events.length === 100, `${res.events.length} returned for limit ${asked}`)
    } else {
      console.log(`   → cap not exercised: ${res.events.length} < 100 rows exist to return`)
    }
  }

  // The one that decides whether Peek's textual `mentionsUser` can be replaced:
  // the relay index is `p`-tag based, so a mention Peek's composer did not tag
  // is invisible to it. Reported as a count, not a tick — the gap is the point.
  const tagged = res.events.filter((e) => tagValue(e, 'p') === t.pubkey).length
  console.log(`   → ${tagged}/${res.events.length} mention rows carry a \`p\` tag for the viewer`)
}

/* ------------------------------------------------------------------ *
 * 3. kind:39005 thread summaries
 * ------------------------------------------------------------------ */

async function probeSummaries(t: Token, channels: string[]): Promise<void> {
  console.log('\n— 3. `kind:39005` thread summaries ——————————————')
  if (channels.length === 0) {
    undecided('`include_summaries` returns 39005 overlays', 'no readable channel was found in leg 1')
    return
  }

  // One channel at a time, because of the claim being tested three lines down.
  // Every channel, not the first few: a thread summary exists only for a root
  // that has replies, so stopping early cannot tell "the overlay is not served"
  // from "these particular channels are flat" — and that is exactly the false
  // negative this probe exists to avoid.
  let used: string | undefined
  let summaries: SignedEvent[] = []
  let bounds = 0
  let roots = 0
  for (const ch of channels) {
    const res = await query(
      [{ kinds: [KIND_CHANNEL_MESSAGE], '#h': [ch], limit: 20, top_level: true, include_summaries: true }],
      t,
    )
    if (res.status !== 200) {
      undecided('`top_level` + `include_summaries` is served', `/query answered ${res.status} ${res.text.slice(0, 120)}`)
      return
    }
    const s = res.events.filter((e) => e.kind === KIND_THREAD_SUMMARY)
    const msgs = res.events.filter((e) => e.kind === KIND_CHANNEL_MESSAGE).length
    roots += msgs
    console.log(`   · ${ch.slice(0, 8)}… ${msgs} top-level, ${s.length} summary/ies`)
    if (s.length > 0) {
      used = ch
      summaries = s
      bounds = res.events.filter((e) => e.kind === KIND_WINDOW_BOUNDS).length
      break
    }
    if (!used && msgs > 0) used = ch
  }
  console.log(`   → ${roots} top-level message(s) across ${channels.length} channel(s)`)

  if (summaries.length === 0) {
    undecided(
      '39005 carries {reply_count, descendant_count, last_reply_at, participants}',
      `no thread summary across ${channels.length} readable channel(s) holding ${roots} top-level message(s) — a summary exists only for a root that has replies`,
    )
  } else {
    check(`\`include_summaries\` returns 39005 overlays (channel ${used?.slice(0, 8)}…)`, true, `${summaries.length} summary/ies, ${bounds} window-bounds`)
    let shaped = 0
    let maxParticipants = 0
    let capped = 0
    for (const s of summaries) {
      let content: Record<string, unknown>
      try {
        content = JSON.parse(s.content) as Record<string, unknown>
      } catch {
        continue
      }
      const participants = Array.isArray(content.participants) ? content.participants : []
      if (
        typeof content.reply_count === 'number' &&
        typeof content.descendant_count === 'number' &&
        'last_reply_at' in content &&
        Array.isArray(content.participants)
      ) {
        shaped++
      }
      maxParticipants = Math.max(maxParticipants, participants.length)
      if (participants.length >= 10) capped++
    }
    check(
      '39005 content is {reply_count, descendant_count, last_reply_at, participants}',
      shaped === summaries.length,
      `${shaped}/${summaries.length} well-shaped`,
    )
    // The trap SHR-10 calls load-bearing: `participants` is capped at 10, so a
    // thread with more can omit you and the participation rule must fall back
    // to the replies. Print the observed maximum whether or not it hits 10 —
    // "never saw 10" is a fact about this workspace, not about the cap.
    console.log(
      `   → largest \`participants\` seen: ${maxParticipants}${capped > 0 ? ` (${capped} thread(s) at the cap)` : ' — cap not exercised here'}`,
    )
  }

  // One `#h` per `top_level` filter. The claim is a 400, and it matters because
  // N channels is N filters in one POST rather than one filter listing N.
  if (channels.length >= 2) {
    const two = await query(
      [
        {
          kinds: [KIND_CHANNEL_MESSAGE],
          '#h': [channels[0], channels[1]],
          limit: 5,
          top_level: true,
          include_summaries: true,
        },
      ],
      t,
    )
    check(
      '`top_level` refuses two `#h` in one filter',
      two.status === 400,
      `status ${two.status} ${two.text.slice(0, 100)}`,
    )
  } else {
    undecided('`top_level` refuses two `#h` in one filter', 'only one readable channel was found')
  }
}

/* ------------------------------------------------------------------ *
 * 4. HTTP-bridge-only: the WS REQ path
 * ------------------------------------------------------------------ */

/**
 * Open a socket, answer NIP-42 AUTH if the relay asks, run one REQ to EOSE.
 *
 * The claim is that `nostr::Filter` silently drops `top_level`,
 * `include_summaries` and `feed_types` — *silently* being the word that makes
 * this worth probing: a socket that returned an error would already have told
 * anyone who tried. So the pass condition is "the REQ succeeds and the
 * extension's events are absent", which is indistinguishable from a broken
 * socket unless the same REQ *without* the extensions returns rows. Both are
 * run, and the second is the control.
 */
async function wsReq(
  filter: Record<string, unknown>,
  t: Token,
  timeoutMs = 12_000,
): Promise<{ ok: boolean; events: SignedEvent[]; note: string }> {
  const url = RELAY_URL.replace(/^http/, 'ws').replace(/\/+$/, '') + '/'
  return await new Promise((resolve) => {
    const events: SignedEvent[] = []
    let settled = false
    let authed = false
    const ws = new WebSocket(url)
    const done = (ok: boolean, note: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        /* already closing */
      }
      resolve({ ok, events, note })
    }
    const timer = setTimeout(() => done(false, `no EOSE within ${timeoutMs}ms`), timeoutMs)

    ws.onerror = () => done(false, 'socket error')
    ws.onclose = () => done(false, 'socket closed before EOSE')
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 'shr10', filter]))
    ws.onmessage = async (msg) => {
      let frame: unknown[]
      try {
        frame = JSON.parse(String(msg.data)) as unknown[]
      } catch {
        return
      }
      const [verb] = frame
      if (verb === 'AUTH' && !authed) {
        authed = true
        const challenge = String(frame[1])
        if (!t.allowedKinds.includes(22242)) {
          done(false, 'relay asked for NIP-42 AUTH and the identity may not sign kind:22242')
          return
        }
        try {
          const signed = await sign(
            {
              pubkey: t.pubkey,
              created_at: Math.floor(Date.now() / 1000),
              kind: 22242,
              tags: [
                ['relay', url],
                ['challenge', challenge],
              ],
              content: '',
            },
            t.accessToken,
          )
          ws.send(JSON.stringify(['AUTH', signed]))
          // Re-issue: a REQ sent before AUTH may have been answered with an
          // empty EOSE, which is the false negative this whole leg is about.
          ws.send(JSON.stringify(['REQ', 'shr10', filter]))
        } catch (error) {
          done(false, `could not sign the AUTH challenge: ${(error as Error).message}`)
        }
        return
      }
      if (verb === 'EVENT') events.push(frame[2] as SignedEvent)
      if (verb === 'EOSE') done(true, `${events.length} event(s)`)
      if (verb === 'CLOSED' || verb === 'NOTICE') done(false, `relay said ${verb}: ${String(frame[2] ?? frame[1])}`)
    }
  })
}

async function probeWsDropsExtensions(t: Token, channels: string[]): Promise<void> {
  console.log('\n— 4. WS `REQ` drops the extension fields ——————————————')
  if (channels.length === 0) {
    undecided('WS REQ drops `top_level`/`include_summaries`', 'no readable channel was found in leg 1')
    return
  }
  const ch = channels[0]

  // The control first. If a plain REQ returns nothing, the socket cannot decide
  // anything about the extensions and the leg is unproven rather than passed.
  const plain = await wsReq({ kinds: [KIND_CHANNEL_MESSAGE], '#h': [ch], limit: 10 }, t)
  if (!plain.ok) {
    undecided('WS REQ drops the extension fields', `the control REQ did not complete: ${plain.note}`)
    return
  }
  check(`WS control: a plain REQ on channel ${ch.slice(0, 8)}… answers`, plain.events.length > 0, plain.note)
  if (plain.events.length === 0) {
    undecided('WS REQ drops the extension fields', 'the control REQ returned no rows, so an absent overlay proves nothing')
    return
  }

  const extended = await wsReq(
    { kinds: [KIND_CHANNEL_MESSAGE], '#h': [ch], limit: 10, top_level: true, include_summaries: true },
    t,
  )
  if (!extended.ok) {
    // Worth distinguishing from the claim: an error is *not* silent dropping.
    check('WS REQ does not serve `include_summaries`', true, `REQ did not complete: ${extended.note} (an error, not a silent drop)`)
    return
  }
  const overlays = extended.events.filter((e) => e.kind === KIND_THREAD_SUMMARY || e.kind === KIND_WINDOW_BOUNDS)
  check(
    'WS REQ silently drops `top_level`/`include_summaries` (no 39005/39006 overlay)',
    overlays.length === 0,
    `${extended.events.length} event(s), ${overlays.length} overlay(s)`,
  )

  const feed = await wsReq({ kinds: [KIND_CHANNEL_MESSAGE], feed_types: ['mentions'], limit: 10 }, t)
  if (!feed.ok) {
    check('WS REQ does not serve `feed_types`', true, `REQ did not complete: ${feed.note} (an error, not a silent drop)`)
  } else {
    // Dropped means the filter degrades to "kind:9, no #h" — which on this relay
    // is either everything readable or nothing, but in neither case a mention
    // feed. Reported as a count so the reader can see which happened.
    console.log(`   → WS \`feed_types\` REQ completed with ${feed.events.length} event(s) — the filter degraded to a plain kind:9 read`)
    check('WS REQ does not error on `feed_types` (it drops it)', true, `${feed.events.length} event(s)`)
  }
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Set ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET (source ~/.estiva-agent.env).')
    process.exit(2)
  }
  console.log(`relay ${RELAY_URL} · id ${ID_ORIGIN}`)
  const t = await token()
  console.log(`viewer ${t.pubkey.slice(0, 16)}… · allowed_kinds ${JSON.stringify(t.allowedKinds)}`)

  const channels = await probeMemberAdded(t)
  await probeMentions(t)
  await probeSummaries(t, channels)
  await probeWsDropsExtensions(t, channels)

  console.log(`\n${failures} failed, ${unproven} unproven.`)
  // An unproven leg is not a failure — it is a leg this identity could not
  // decide, and it must be read rather than rounded to green.
  process.exit(failures > 0 ? 1 : 0)
}

void main()
