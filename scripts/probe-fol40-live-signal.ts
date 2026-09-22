/**
 * What stops the team dot's live signal — FOL-40, third attempt.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-fol40-live-signal.ts
 *
 * Two PRs shipped the right subscription and the dot still only moves on a
 * refresh. An agent cannot open an authenticated socket (Estiva ID refuses to
 * sign a `kind:22242`), so this probes everything around it that *is* readable
 * and prints which of the remaining suspects survives:
 *
 * 1. **The WebSocket upgrade, with a browser's `Origin`.** If the relay
 *    refuses `Origin: https://peek.estiva.app` at the handshake, nothing in
 *    the tab is ever live and every live feature in production is broken the
 *    same way. Unauthenticated is fine here: the upgrade is the question, and
 *    `auth-required` is a successful upgrade.
 * 2. **The deployed relay's explicit-channel budget.** `MAX_EXPLICIT_CHANNEL_VALUES`
 *    (128) is enforced in `extract_channel_ids_from_filters_limited`, the same
 *    function that collects a *multi*-`#h` filter's channels. An HTTP `/query`
 *    of 129 values is refused `too many explicit channels` only by a build
 *    that has it — which dates what is running against what
 *    `nfb-demo-kinds` says.
 * 3. **Multi-`#h` scoping on the deployed build**: one filter naming two
 *    Folders, answered with events from both, is the plural extraction
 *    working end to end on the read path.
 *
 * Read-only: three `POST /query` and one WebSocket handshake that subscribes
 * to nothing.
 */
import { WebSocket } from 'ws'
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'https://peek.estiva.app'

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

async function query(
  filters: unknown[],
  t: { accessToken: string; pubkey: string },
): Promise<{ status: number; text: string }> {
  const url = `${RELAY_URL.replace(/\/+$/, '')}/query`
  const body = JSON.stringify(filters)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  return { status: res.status, text: await res.text() }
}

const tag = (e: SignedEvent, name: string) => e.tags.find((x) => x[0] === name)?.[1]

/** The handshake, with the browser's Origin. Resolves with what happened. */
function handshake(origin: string | undefined): Promise<string> {
  return new Promise((resolve) => {
    const url = RELAY_URL.replace(/^http/, 'ws').replace(/\/+$/, '')
    const socket = new WebSocket(url, origin ? { headers: { Origin: origin } } : {})
    const done = (verdict: string) => {
      try {
        socket.close()
      } catch {
        /* already gone */
      }
      resolve(verdict)
    }
    const timer = setTimeout(() => done('no answer in 10 s'), 10_000)
    socket.on('open', () => {
      // Upgraded. Ask for something unauthenticated so the relay says its piece.
      socket.send(JSON.stringify(['REQ', 'probe', { kinds: [1111], limit: 1 }]))
    })
    socket.on('message', (raw) => {
      clearTimeout(timer)
      done(`upgraded, first frame: ${String(raw).slice(0, 160)}`)
    })
    socket.on('error', (error: Error) => {
      clearTimeout(timer)
      done(`refused: ${error.message}`)
    })
    socket.on('unexpected-response', (_req, res) => {
      clearTimeout(timer)
      done(`refused at the upgrade: HTTP ${res.statusCode}`)
    })
  })
}

async function main() {
  const t = await token()
  console.log(`identity ${t.pubkey.slice(0, 8)}…, relay ${RELAY_URL}`)

  // 1. The upgrade, with and without a browser's Origin.
  console.log(`\n[1] handshake, no Origin      : ${await handshake(undefined)}`)
  console.log(`[1] handshake, Origin ${APP_ORIGIN}: ${await handshake(APP_ORIGIN)}`)

  // 2. The explicit-channel budget, which only a build carrying the plural
  //    extraction enforces.
  const fake = (n: number) =>
    Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
  for (const n of [128, 129]) {
    const answer = await query([{ kinds: [9, 1111], '#h': fake(n) }], t)
    console.log(`\n[2] /query with ${n} #h values: HTTP ${answer.status} ${answer.text.slice(0, 120)}`)
  }

  // 3. Multi-`#h` scoping on the read path: two Folders that both hold
  //    messages, asked for in ONE filter.
  const folders = await query([{ kinds: [30890], limit: 200 }], t)
  const ids = (JSON.parse(folders.text) as SignedEvent[])
    .map((e) => tag(e, 'd'))
    .filter(Boolean) as string[]
  const withMessages: string[] = []
  for (const id of ids.slice(0, 40)) {
    const one = await query([{ kinds: [9, 1111], '#h': [id], limit: 1 }], t)
    if ((JSON.parse(one.text) as SignedEvent[]).length > 0) withMessages.push(id)
    if (withMessages.length === 2) break
  }
  if (withMessages.length < 2) {
    console.log('\n[3] fewer than two Folders with messages — cannot test the OR')
    return
  }
  const both = await query([{ kinds: [9, 1111], '#h': withMessages, limit: 50 }], t)
  const seen = new Set(
    (JSON.parse(both.text) as SignedEvent[]).map((e) => tag(e, 'h')).filter(Boolean) as string[],
  )
  console.log(
    `\n[3] one filter naming ${withMessages.length} Folders answered from ${seen.size}: ` +
      `${[...seen].map((h) => h.slice(0, 8)).join(', ')}`,
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
