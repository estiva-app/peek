/**
 * End-to-end publish probe — the test Phase 4 could not run.
 *
 * Deliberately imports Peek's REAL modules (`convex/nostr/*`) rather than
 * reimplementing anything, so this exercises the code that will ship.
 *
 * Run:  npx vite-node docs/buzz-compat/publish-to-relay.ts
 */
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import { buildCreateChannel, buildMessage, buildProfile } from '../../convex/nostr/events'
import { publicKeyFromSecret, signEvent } from '../../convex/nostr/sign'
import { authorizationHeader } from '../../convex/nostr/nip98'

const RELAY = process.env.BUZZ_RELAY_URL ?? 'http://localhost:3000'

/** Stable dev identity so reruns are reproducible. Probe-grade, not a real key. */
const SECRET = bytesToHex(sha256(utf8ToBytes('peek:dev:alice')))
const PUBKEY = publicKeyFromSecret(SECRET)

/** Fresh channel per run so repeated runs don't collide on an existing one. */
const CHANNEL = crypto.randomUUID()

async function post(path: string, payload: unknown): Promise<{ status: number; body: string }> {
  const url = `${RELAY}${path}`
  const body = JSON.stringify(payload)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Fresh auth event per request — the relay records each auth event id in a
      // replay set, so a reused header is rejected.
      authorization: authorizationHeader({
        pubkey: PUBKEY,
        secretKeyHex: SECRET,
        url,
        method: 'POST',
        body,
      }),
    },
    body,
  })
  return { status: res.status, body: await res.text() }
}

function report(label: string, r: { status: number; body: string }): boolean {
  const ok = r.status >= 200 && r.status < 300
  console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${label}  (HTTP ${r.status})`)
  console.log(`       ${r.body.slice(0, 400)}`)
  return ok
}

async function main() {
  console.log(`relay   : ${RELAY}`)
  console.log(`pubkey  : ${PUBKEY}`)
  console.log(`channel : ${CHANNEL}`)

  const now = Date.now()
  let allOk = true

  // 1. Profile, so the author renders as a person rather than a raw pubkey.
  const profile = signEvent(
    buildProfile(PUBKEY, now, { display_name: 'Alice Chen', about: 'Design Lead' }),
    SECRET,
  )
  allOk = report('kind:0 profile', await post('/events', profile)) && allOk

  // 2. Create the channel.
  const channel = signEvent(
    buildCreateChannel(PUBKEY, now, {
      channelUuid: CHANNEL,
      name: 'Onboarding redesign',
      visibility: 'open',
      channelType: 'stream',
    }),
    SECRET,
  )
  allOk = report('kind:9007 create channel', await post('/events', channel)) && allOk

  // 3. The message — the actual interop payload.
  const message = signEvent(
    buildMessage(PUBKEY, now, {
      channelUuid: CHANNEL,
      content: 'The new sign-up flow drops a step. Worth a look before Friday.',
    }),
    SECRET,
  )
  console.log(`\nmessage event id: ${message.id}`)
  allOk = report('kind:9 message', await post('/events', message)) && allOk

  // 4. Read it back the way any Nostr client would.
  // NOTE: /query takes a bare JSON ARRAY of filters (`Vec<Value>` in
  // bridge.rs:970), not a single filter object and not {filters: […]}.
  const query = await post('/query', [{ kinds: [9], '#h': [CHANNEL], limit: 10 }])
  allOk = report('POST /query reads it back', query) && allOk

  const roundTripped = query.body.includes(message.id)
  console.log(
    `\n[${roundTripped ? 'PASS' : 'FAIL'}] the exact event id came back from the relay`,
  )

  console.log(`\n=== RESULT: ${allOk && roundTripped ? 'PASS' : 'FAIL'} ===`)
  process.exit(allOk && roundTripped ? 0 : 1)
}

main().catch((e) => {
  console.error('probe failed:', e)
  process.exit(1)
})
