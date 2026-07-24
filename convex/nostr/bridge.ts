/**
 * Client for Buzz's HTTP bridge (`POST /events`, `POST /query`).
 *
 * Every behavior here was established against a running relay, not inferred —
 * the surprises are called out inline because each one is a silent-failure trap.
 */
import { authorizationHeader } from './nip98'
import type { SignedEvent } from './events'

/** Where to publish. Publishing is OFF unless this is set — that is the flag. */
export function relayUrl(): string | null {
  const url = process.env.NOSTR_RELAY_URL?.trim()
  return url ? url.replace(/\/+$/, '') : null
}

export interface PublishResult {
  ok: boolean
  eventId?: string
  /** Set when the relay declined. `duplicate` is called out separately below. */
  reason?: string
  /** True when the relay already had this state — not a failure. */
  duplicate?: boolean
  httpStatus: number
}

async function bridgeFetch(
  path: string,
  payload: unknown,
  auth: { pubkey: string; secretKeyHex: string },
): Promise<{ status: number; text: string }> {
  const base = relayUrl()
  if (!base) throw new Error('NOSTR_RELAY_URL is not set')
  const url = `${base}${path}`
  const body = JSON.stringify(payload)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Rebuilt per call, and unique per call — see nip98.ts on the nonce.
      authorization: authorizationHeader({ ...auth, url, method: 'POST', body }),
    },
    body,
  })
  return { status: res.status, text: await res.text() }
}

/**
 * Publish one signed event.
 *
 * **HTTP 200 does not mean accepted.** The relay answers a duplicate channel
 * create with `200 {"accepted":false,"message":"duplicate: channel already
 * exists"}`. Checking only the status code silently treats rejections as
 * successes, so the `accepted` field is authoritative here.
 */
export async function publishEvent(
  event: SignedEvent,
  auth: { pubkey: string; secretKeyHex: string },
): Promise<PublishResult> {
  const { status, text } = await bridgeFetch('/events', event, auth)

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
    return {
      ok: duplicate,
      duplicate,
      eventId: parsed.event_id,
      reason: parsed.message,
      httpStatus: status,
    }
  }

  return { ok: true, eventId: parsed.event_id, httpStatus: status }
}

/**
 * Run Nostr filters against the relay.
 *
 * Takes a **bare JSON array** of filters — `Vec<Value>` in `bridge.rs:970`.
 * Sending a single filter object gets `invalid type: map, expected a sequence`.
 */
export async function queryEvents(
  filters: Record<string, unknown>[],
  auth: { pubkey: string; secretKeyHex: string },
): Promise<{ ok: boolean; events: SignedEvent[]; reason?: string }> {
  const { status, text } = await bridgeFetch('/query', filters, auth)
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
