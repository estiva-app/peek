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
 * - **Single use, and "fresh" is not enough.** Each auth event id is recorded in
 *   a Redis seen-set (`check_nip98_replay`, bridge.rs:135). Rebuilding the header
 *   per request does *not* guarantee a new id: `created_at` has one-second
 *   resolution, so two requests with the same URL, method and body inside the
 *   same second produce a byte-identical event and the second is rejected with
 *   `NIP-98: replay detected`. Verified against the live relay. Hence the
 *   `nonce` tag below — it is what makes each auth event unique.
 */
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils'
import { KIND, type NostrTag, type SignedEvent, type UnsignedEvent } from './events'
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
export function buildUnsignedAuthEvent(args: {
  pubkey: string
  url: string
  method: string
  /** Request body, when there is one — adds the `payload` tag. */
  body?: string
  /** Override for tests; defaults to now. */
  nowMs?: number
  /** Override for tests; defaults to random. Must differ per request. */
  nonce?: string
}): UnsignedEvent {
  const tags: NostrTag[] = [
    ['u', normalizeUrl(args.url)],
    ['method', args.method.toUpperCase()],
    // Uniqueness, not security: without it, two identical requests in the same
    // second collide on the event id and the relay rejects the second as a
    // replay. The verifier ignores tags it does not know (it looks up `u`,
    // `method` and `payload` by name), so this is safe to add.
    ['nonce', args.nonce ?? bytesToHex(randomBytes(16))],
  ]
  if (args.body !== undefined) {
    tags.push(['payload', bytesToHex(sha256(utf8ToBytes(args.body)))])
  }
  return {
    pubkey: args.pubkey,
    created_at: Math.floor((args.nowMs ?? Date.now()) / 1000),
    kind: KIND.HTTP_AUTH,
    tags,
    content: '',
  }
}

/**
 * The local-key variant: build and sign in one step.
 *
 * Kept because custodial publishing holds a raw secret and has no reason to go
 * near the identity service. The remote path composes the same builder with
 * `signAs` instead, so **the tag layout has exactly one definition** — it is
 * part of the event id preimage, and two copies drifting would produce ids the
 * relay computes differently.
 */
export function buildAuthEvent(
  args: Parameters<typeof buildUnsignedAuthEvent>[0] & { secretKeyHex: string },
): SignedEvent {
  return signEvent(buildUnsignedAuthEvent(args), args.secretKeyHex)
}

/** Base64 without Node's Buffer, so this works in either Convex runtime. */
export function base64(input: string): string {
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
  return authorizationHeaderFor(buildAuthEvent(args))
}

/**
 * Header value for an auth event signed elsewhere — remotely, via `/sign`.
 *
 * Uses the utf8-aware `base64` above rather than a bare `btoa`, which throws on
 * any code point above U+00FF.
 */
export function authorizationHeaderFor(signed: SignedEvent): string {
  return `Nostr ${base64(JSON.stringify(signed))}`
}
