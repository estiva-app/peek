/**
 * Browser-side client for `/sign` and Buzz's HTTP bridge (PEEK-106).
 *
 * The counterpart to `convex/nostr/bridge.ts`, and eventually its replacement
 * for every user-attributed path. The reason it exists is not architectural
 * neatness: **Convex surfaces function arguments in its dashboard logs**, so
 * every `estivaAccessToken` passed to an action is a bearer token — usable to
 * publish under that person's name — sitting in log retention for anyone with
 * dashboard access. Raising the access-token TTL to 3600s widened that window
 * six-fold.
 *
 * Ship never had the problem: `estivaIdSigner` calls `/sign` straight from the
 * browser, so its backend holds no user credential at all. This is Peek
 * reaching the same shape. The division of labour becomes:
 *
 *   1. Convex builds the **unsigned** event from its own rows — it has the data
 *      and needs no credential to shape it
 *   2. the browser signs it via `/sign` and POSTs it to the relay — it has the
 *      token and it is the only place the token belongs
 *   3. Convex records the resulting event id — a fact, not a secret
 *
 * Both endpoints are CORS-open to `peek.estiva.app`, verified against the live
 * services rather than assumed.
 *
 * **The tag layout is deliberately not re-implemented here.** `buildUnsignedAuthEvent`
 * is imported from the Convex tree because it is part of the event id preimage:
 * a second copy would not be duplication, it would be a silent divergence the
 * relay notices and we do not. Those modules are pure and browser-safe —
 * `@noble/hashes` and `btoa`, no Node built-ins.
 */
import { authorizationHeaderFor, buildUnsignedAuthEvent } from '../../convex/nostr/nip98'
import type { SignedEvent, UnsignedEvent } from '../../convex/nostr/events'
import { ESTIVA_ID_ORIGIN } from '@/auth/estivaId'

export type PublishResult = {
  ok: boolean
  duplicate?: boolean
  eventId?: string
  reason?: string
  httpStatus?: number
}

/**
 * Sign as the token's subject.
 *
 * `expectedPubkey` is not a request — `/sign` ignores any pubkey it is handed
 * and signs as the token's subject, always. It is a **check**, and the reason
 * one is needed at all: a mismatch comes back as HTTP 200 with a perfectly
 * valid event authored by somebody else. Without this the failure is invisible
 * at the call site and only shows up later as a message attributed to the wrong
 * person. `signWithIdentityService` keeps the same guard server-side; do not
 * drop either.
 */
export async function signViaEstivaId(
  unsigned: UnsignedEvent,
  token: string,
  expectedPubkey?: string,
): Promise<SignedEvent> {
  const response = await fetch(`${ESTIVA_ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (!response.ok) {
    throw new Error(`POST /sign failed: ${response.status} ${await response.text()}`)
  }
  const body = (await response.json()) as { event?: SignedEvent }
  if (!body.event) throw new Error('POST /sign returned no event')
  if (expectedPubkey && body.event.pubkey !== expectedPubkey) {
    throw new Error(
      `POST /sign returned an event authored by ${body.event.pubkey}, expected ${expectedPubkey}. ` +
        'That token belongs to a different identity — refusing to publish under the wrong author.',
    )
  }
  return body.event
}

/**
 * One authenticated POST to the bridge.
 *
 * The NIP-98 auth event goes through `/sign` too, not just the content. That is
 * the half that is easy to leave out and impossible to spot afterwards: an app
 * that can sign content but not auth holds a perfectly valid event the bridge
 * will not accept, and the seam looks finished.
 *
 * `pubkey` is left empty in the auth event for the same reason as the server
 * path — `/sign` overwrites it with the token's subject, and the guard above
 * rejects a mismatch.
 */
async function bridgePost(
  relayUrl: string,
  path: string,
  payload: unknown,
  token: string,
  pubkey?: string,
): Promise<{ status: number; text: string }> {
  const url = `${relayUrl.replace(/\/+$/, '')}${path}`
  const body = JSON.stringify(payload)
  const auth = await signViaEstivaId(
    buildUnsignedAuthEvent({ pubkey: pubkey ?? '', url, method: 'POST', body }),
    token,
    pubkey,
  )
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  return { status: res.status, text: await res.text() }
}

/**
 * Publish one signed event.
 *
 * **HTTP 200 does not mean accepted** — the relay answers a duplicate channel
 * create with `200 {"accepted":false,…}`, so the `accepted` field is
 * authoritative and the status code alone would read rejections as successes.
 * Same parsing as the server client, and for the same measured reasons.
 */
export async function publishSigned(
  relayUrl: string,
  event: SignedEvent,
  token: string,
  pubkey?: string,
): Promise<PublishResult> {
  const { status, text } = await bridgePost(relayUrl, '/events', event, token, pubkey)

  let parsed: { accepted?: boolean; event_id?: string; message?: string; error?: string } = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, reason: `unparseable response: ${text.slice(0, 200)}`, httpStatus: status }
  }

  if (status < 200 || status >= 300) {
    return { ok: false, reason: parsed.error ?? text.slice(0, 200), httpStatus: status }
  }

  if (parsed.accepted === false) {
    // "already exists" is the desired end state, so callers treat it as success.
    const duplicate = (parsed.message ?? '').startsWith('duplicate:')
    return { ok: duplicate, duplicate, eventId: parsed.event_id, reason: parsed.message, httpStatus: status }
  }

  return { ok: true, eventId: parsed.event_id, httpStatus: status }
}

/**
 * Run Nostr filters against the relay.
 *
 * Takes a **bare JSON array** of filters — sending a single filter object gets
 * `invalid type: map, expected a sequence`.
 *
 * A non-member read is answered `403 relay_membership_required`, which is why
 * reads are viewer-driven in the first place: there is no backend identity that
 * can see anything.
 */
export async function queryRelay(
  relayUrl: string,
  filters: Record<string, unknown>[],
  token: string,
  pubkey?: string,
): Promise<{ ok: boolean; events: SignedEvent[]; reason?: string }> {
  const { status, text } = await bridgePost(relayUrl, '/query', filters, token, pubkey)
  if (status < 200 || status >= 300) {
    let reason = text.slice(0, 200)
    try {
      reason = JSON.parse(text).error ?? reason
    } catch {
      // keep the raw text
    }
    return { ok: false, events: [], reason }
  }
  try {
    const parsed = JSON.parse(text)
    return { ok: true, events: Array.isArray(parsed) ? parsed : [] }
  } catch {
    return { ok: false, events: [], reason: `unparseable response: ${text.slice(0, 200)}` }
  }
}
