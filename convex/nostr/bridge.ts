/**
 * Client for Buzz's HTTP bridge (`POST /events`, `POST /query`).
 *
 * Every behavior here was established against a running relay, not inferred —
 * the surprises are called out inline because each one is a silent-failure trap.
 */
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import { authorizationHeader as localAuthorizationHeader, normalizeUrl } from './nip98'
import type { SignedEvent, UnsignedEvent } from './events'

export interface RelayAuth {
  pubkey: string | null
  token?: string
  secretKeyHex?: string
}

export type PublishResult = {
  ok: boolean
  duplicate?: boolean
  eventId?: string
  reason?: string
  httpStatus?: number
}

/** Where to publish. Publishing is OFF unless this is set — that is the flag. */
export function relayUrl(): string | null {
  const url = process.env.NOSTR_RELAY_URL?.trim()
  return url ? url.replace(/\/+$/, '') : null
}

export function identityServiceOrigin(): string {
  const raw = process.env.ESTIVA_ID_ORIGIN ?? process.env.VITE_ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
  return raw.replace(/\/+$/, '')
}

function readEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

async function issueServiceToken(): Promise<{ token: string; pubkey: string } | null> {
  const token = readEnv(['ESTIVA_ID_SERVICE_TOKEN', 'ESTIVA_ID_ACCESS_TOKEN', 'ESTIVA_ID_TOKEN'])
  if (token) {
    const payload = token.split('.')[1]
    if (!payload) return { token, pubkey: '' }
    try {
      const json = JSON.parse(
        Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
      ) as { sub?: string }
      if (json.sub) return { token, pubkey: json.sub }
    } catch {
      // fall through to explicit pubkey envs below
    }
  }

  const clientId = readEnv(['ESTIVA_ID_CLIENT_ID', 'ESTIVA_ID_SERVICE_CLIENT_ID']) ?? 'estiva-peek'
  const clientSecret = readEnv(['ESTIVA_ID_CLIENT_SECRET', 'ESTIVA_ID_SERVICE_CLIENT_SECRET'])
  if (!clientSecret) return null

  const res = await fetch(`${identityServiceOrigin()}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grantType: 'client_credentials', clientId, clientSecret }),
  })
  if (!res.ok) throw new Error(`Estiva ID token exchange failed: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token?: string; pubkey?: string }
  if (!body.access_token) return null
  return { token: body.access_token, pubkey: body.pubkey ?? '' }
}

export async function serviceIdentity(): Promise<RelayAuth | null> {
  const configuredPubkey = readEnv(['ESTIVA_ID_SERVICE_PUBKEY', 'ESTIVA_ID_PUBKEY'])
  const token = await issueServiceToken()
  if (!token) return null
  const pubkey = configuredPubkey ?? token.pubkey
  if (!pubkey) return null
  return {
    pubkey,
    token: token.token,
  }
}

export async function signWithIdentityService(
  unsigned: UnsignedEvent,
  auth: RelayAuth,
): Promise<SignedEvent> {
  if (!auth.token) throw new Error('No Estiva ID token configured for signing.')
  const response = await fetch(`${identityServiceOrigin()}/sign`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: ['Bearer ', auth.token].join(''),
    },
    body: JSON.stringify({ event: { ...unsigned, pubkey: unsigned.pubkey || auth.pubkey || undefined } }),
  })
  if (!response.ok) {
    throw new Error(`POST /sign failed: ${response.status} ${await response.text()}`)
  }
  const body = (await response.json()) as { event?: SignedEvent }
  if (!body.event) {
    throw new Error('POST /sign returned no event')
  }

  // `/sign` ignores the pubkey we send and signs as the token's subject —
  // "The token's subject is the only pubkey this call may sign as"
  // (estiva-id `src/http/routes/sign.ts`). So handing it a user's pubkey next to
  // a *service* token does not produce an event authored by that user; it
  // produces one authored by the service, silently and with a correct-looking
  // `pubkey` field in our own bookkeeping.
  //
  // Refusing the mismatch centrally means no publish path can misattribute
  // authorship: either the event belongs to whoever we named, or nothing is
  // published and the error says why.
  if (auth.pubkey && body.event.pubkey !== auth.pubkey) {
    throw new Error(
      `POST /sign returned an event authored by ${body.event.pubkey}, expected ${auth.pubkey}. ` +
        'That token belongs to a different identity — refusing to publish under the wrong author.',
    )
  }
  return body.event
}

async function bridgeAuthorizationHeader(
  url: string,
  method: string,
  body: string,
  auth: RelayAuth,
): Promise<string> {
  if (auth.secretKeyHex) {
    if (!auth.pubkey) {
      throw new Error('Pubkey required when using secret key auth')
    }
    return localAuthorizationHeader({
      pubkey: auth.pubkey,
      secretKeyHex: auth.secretKeyHex,
      url,
      method,
      body,
    })
  }
  if (!auth.token) {
    throw new Error('No relay auth token available')
  }

  // For both user tokens and service tokens, sign NIP-98 auth event
  // The relay requires the Nostr auth format, not plain Bearer tokens
  const unsigned = {
    pubkey: auth.pubkey || '', // Empty for user tokens, service will derive from token
    created_at: Math.floor(Date.now() / 1000),
    kind: 27235,
    tags: [
      ['u', normalizeUrl(url)],
      ['method', method.toUpperCase()],
      ['nonce', crypto.randomUUID()],
      ['payload', bytesToHex(sha256(utf8ToBytes(body)))],
    ],
    content: '',
  }
  const signed = await signWithIdentityService(unsigned, auth)
  return `Nostr ${btoa(JSON.stringify(signed))}`
}

async function bridgeFetch(
  path: string,
  payload: unknown,
  auth: RelayAuth,
): Promise<{ status: number; text: string }> {
  const base = relayUrl()
  if (!base) throw new Error('NOSTR_RELAY_URL is not set')
  const url = `${base}${path}`
  const body = JSON.stringify(payload)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: await bridgeAuthorizationHeader(url, 'POST', body, auth),
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
export async function publishEvent(event: SignedEvent, auth: RelayAuth): Promise<PublishResult> {
  const { status, text } = await bridgeFetch('/events', event, auth)
  // The status alone is not acceptance: the relay uses HTTP 200 for some
  // rejections. This trace intentionally records only relay output, never the
  // bearer token or signed authorization header.
  console.log(
    `[TRACE] publishEvent: kind=${event.kind}, eventId=${event.id}, ` +
      `status=${status}, response=${text.slice(0, 500)}`,
  )

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
  auth: RelayAuth,
): Promise<{ ok: boolean; events: SignedEvent[]; reason?: string }> {
  const pubkeyLog = auth.pubkey ? auth.pubkey.slice(0, 16) + '…' : 'null'
  console.log(`[TRACE] queryEvents: relayUrl=${relayUrl()}, filters=${JSON.stringify(filters)}, auth.pubkey=${pubkeyLog}, auth.token=${auth.token ? 'present' : 'none'}, auth.secretKeyHex=${auth.secretKeyHex ? 'present' : 'none'}`)
  const { status, text } = await bridgeFetch('/query', filters, auth)
  console.log(`[TRACE] queryEvents: status=${status}, response.length=${text.length}`)
  if (status < 200 || status >= 300) {
    let reason = text.slice(0, 200)
    try {
      reason = JSON.parse(text).error ?? reason
    } catch {
      // keep the raw text
    }
    console.log(`[TRACE] queryEvents: FAILED reason=${reason}`)
    return { ok: false, events: [], reason }
  }
  try {
    const parsed = JSON.parse(text)
    console.log(`[TRACE] queryEvents: parsed events count=${Array.isArray(parsed) ? parsed.length : 'not array'}`)
    return { ok: true, events: Array.isArray(parsed) ? parsed : [] }
  } catch {
    console.log(`[TRACE] queryEvents: PARSE FAILED text=${text.slice(0, 200)}`)
    return { ok: false, events: [], reason: `unparseable response: ${text.slice(0, 200)}` }
  }
}
