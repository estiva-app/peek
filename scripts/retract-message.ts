/**
 * Publish a kind:5 for a message Peek holds, to verify the inbound half of
 * PEEK-113 — that a deletion written elsewhere removes the row here.
 *
 *   ESTIVA_TOKEN=<access token> \
 *   RELAY_URL=https://estiva.estiva.app \
 *     npx tsx scripts/retract-message.ts <nostrEventId>
 *
 * ## Why this exists rather than a click in Ship
 *
 * **Ship cannot delete a message.** It publishes a kind:5 only for a *project
 * record* (`deleteProject`, `apps/ship/views/project.ts`), so the done-when as
 * originally written — "a message deleted in Ship disappears from Peek" —
 * describes something no button anywhere can do. Same shape as the reaction
 * limitation: Ship has no reactions either, so that side was never testable.
 *
 * **And Peek cannot stand in for Ship.** Both clients share one Convex
 * database, so deleting a message in Peek removes the row directly and the
 * import path never runs. The relay leg would be entirely invisible, and a
 * green result would mean nothing.
 *
 * So the only honest test is to put a real kind:5 on the relay and watch Peek
 * notice it. That is what this does.
 *
 * ## Getting the two inputs
 *
 * **The token** is the signed-in user's, from the browser: with Peek open,
 * `JSON.parse(sessionStorage.getItem('estiva-id-token')).accessToken`. It is
 * short-lived; if `/sign` returns 401, take a fresh one.
 *
 * **The event id** is `nostrEventId` on the message row — visible in the Convex
 * dashboard's `messages` table.
 *
 * ## What the relay will and will not accept
 *
 * NIP-09 is **author-scoped**: Buzz honours a kind:5 only from the pubkey that
 * signed the original. `/sign` signs as the token's subject and ignores any
 * pubkey it is handed, so this can only ever retract a message *that person
 * wrote*. Pointing it at someone else's message is refused by the relay, which
 * is the correct outcome and not a bug in this script.
 *
 * **This is not reversible.** The event is genuinely retracted on the shared
 * relay, for every app reading it, not just for Peek. Use a message written for
 * the purpose.
 */
const ID_ORIGIN = (process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app').replace(/\/+$/, '')
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const TOKEN = process.env.ESTIVA_TOKEN

const targetEventId = process.argv[2]

const die = (message: string): never => {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

if (!TOKEN) die('Set ESTIVA_TOKEN to the signed-in user\'s access token (see the header).')
if (!targetEventId || !/^[0-9a-f]{64}$/.test(targetEventId)) {
  die('Pass the target message\'s nostrEventId — 64 hex characters.')
}

/** Sign as the token's subject. The pubkey we send is ignored by `/sign`. */
async function sign(event: Record<string, unknown>) {
  const response = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ event }),
  })
  if (!response.ok) die(`POST /sign failed: ${response.status} ${await response.text()}`)
  const body = (await response.json()) as { event?: Record<string, unknown> }
  if (!body.event) die('POST /sign returned no event')
  return body.event!
}

/**
 * NIP-98 auth for the bridge, signed through `/sign` as well.
 *
 * The easy omission: Buzz authenticates every route this way, so an app that
 * signs content but not auth holds a valid event it cannot publish. The `nonce`
 * is what stops two identical requests in the same second colliding on one
 * event id and being rejected as a replay.
 */
async function authHeader(url: string, body: string) {
  const payloadHash = await crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(body))
    .then((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''))
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const auth = await sign({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', 'POST'],
      ['nonce', nonce],
      ['payload', payloadHash],
    ],
    content: '',
  })
  return `Nostr ${Buffer.from(JSON.stringify(auth), 'utf8').toString('base64')}`
}

async function main() {
  const deletion = await sign({
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', targetEventId]],
    content: '',
  })
  process.stdout.write(`signed kind:5 ${deletion.id} as ${deletion.pubkey}\n`)

  const url = `${RELAY_URL}/events`
  const body = JSON.stringify(deletion)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: await authHeader(url, body) },
    body,
  })
  const text = await response.text()
  process.stdout.write(`relay ${response.status}: ${text}\n`)

  // HTTP 200 is not acceptance — the relay reports some refusals with a 200 and
  // `accepted:false`, so the field is what decides.
  let accepted = false
  try {
    accepted = JSON.parse(text).accepted === true
  } catch {
    // keep accepted false
  }
  if (!accepted) die('\nNot accepted. If this is an authorship refusal, the message was written by somebody else — NIP-09 is author-scoped.')

  process.stdout.write(
    '\nAccepted. Now open that topic in Peek: the message should disappear on sync,\n' +
      'along with its replies. It will NOT disappear until the topic is opened —\n' +
      'sync is viewer-driven, there is no background job.\n',
  )
}

void main()
