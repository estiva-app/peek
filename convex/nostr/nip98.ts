/**
 * NIP-98 HTTP auth for Buzz's REST bridge.
 *
 * Buzz's bridge (`POST /events`, `POST /query`) authenticates with NIP-98, **not**
 * NIP-42 — no challenge/response and no persistent connection, which is what makes
 * it usable from Convex's request-scoped runtime at all.
 *
 * Written against the relay's actual verifier, `verify_nip98_event`
 * (crates/buzz-auth/src/nip98.rs:55). Its rules, in order:
 *
 *   1. kind must be 27235
 *   2. valid Schnorr signature + id hash
 *   3. `created_at` within ±60s of the relay's clock
 *   4. `u` tag must equal the expected URL after normalization
 *   5. `method` tag must match (case-insensitive)
 *   6. if a `payload` tag is present AND a body was sent, sha256(body) must match
 *
 * Two things that bite in practice:
 *
 * - **No loopback aliasing.** `localhost`, `127.0.0.1` and `::1` are distinct
 *   hosts to the verifier (deliberately — it is the row-zero community binding).
 *   The `u` tag must use the same host string as the request's Host header.
 * - **Single use.** Each auth event id is recorded in a Redis seen-set
 *   (`check_nip98_replay`, bridge.rs:135); replaying one is rejected. Build a
 *   fresh header for every request — never cache it.
 */
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import { KIND, type NostrTag, type UnsignedEvent } from './events'
import { signEvent } from './sign'

/** The relay rejects auth events outside ±60s (`TIMESTAMP_TOLERANCE_SECS`). */
export const TIMESTAMP_TOLERANCE_SECS = 60

/**
 * Buzz's `normalize_url` (nip98.rs:145): parse, strip trailing slashes from the
 * path, re-serialize. We only need it to keep our own `u` tag canonical.
 */
export function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw)
    parsed.pathname = parsed.pathname.replace(/\/+$/, '')
    return parsed.toString()
  } catch {
    return raw.toLowerCase()
  }
}

/**
 * Build the signed kind:27235 event backing an `Authorization: Nostr …` header.
 *
 * `url` must be the full request URL with the same host the relay will see —
 * `nip98_expected_url` (bridge.rs:195) reconstructs it as
 * `{http|https}://{host}{path}` from the request's own Host header.
 */
export function buildAuthEvent(args: {
  pubkey: string
  secretKeyHex: string
  url: string
  method: string
  /** Request body, when there is one — adds the `payload` tag. */
  body?: string
  /** Override for tests; defaults to now. */
  nowMs?: number
}): UnsignedEvent & { id: string; sig: string } {
  const tags: NostrTag[] = [
    ['u', normalizeUrl(args.url)],
    ['method', args.method.toUpperCase()],
  ]
  if (args.body !== undefined) {
    tags.push(['payload', bytesToHex(sha256(utf8ToBytes(args.body)))])
  }
  const unsigned: UnsignedEvent = {
    pubkey: args.pubkey,
    created_at: Math.floor((args.nowMs ?? Date.now()) / 1000),
    kind: KIND.HTTP_AUTH,
    tags,
    content: '',
  }
  return signEvent(unsigned, args.secretKeyHex)
}

/** Base64 without Node's Buffer, so this works in either Convex runtime. */
function base64(input: string): string {
  const bytes = utf8ToBytes(input)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/**
 * The full header value: `Nostr <base64(signed kind-27235 event JSON)>`
 * (bridge.rs:81-93 strips the `Nostr ` prefix and base64-decodes the rest).
 */
export function authorizationHeader(args: Parameters<typeof buildAuthEvent>[0]): string {
  return `Nostr ${base64(JSON.stringify(buildAuthEvent(args)))}`
}
