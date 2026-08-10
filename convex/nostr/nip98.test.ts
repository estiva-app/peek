/**
 * NIP-98 auth-header rules, checked against the relay's verifier
 * (crates/buzz-auth/src/nip98.rs:55).
 */
import { describe, expect, it } from 'vitest'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import { authorizationHeader, buildAuthEvent, normalizeUrl } from './nip98'
import { publicKeyFromSecret } from './sign'
import { computeEventId } from './events'

const SECRET = bytesToHex(sha256(utf8ToBytes('nip98-test')))
const PUBKEY = publicKeyFromSecret(SECRET)
const URL_ = 'http://localhost:3000/events'

const auth = (over: Partial<Parameters<typeof buildAuthEvent>[0]> = {}) =>
  buildAuthEvent({ pubkey: PUBKEY, secretKeyHex: SECRET, url: URL_, method: 'POST', ...over })

describe('NIP-98 auth events', () => {
  it('is kind 27235 with a valid self-consistent id', () => {
    const e = auth()
    expect(e.kind).toBe(27235)
    expect(computeEventId(e)).toBe(e.id)
  })

  it('carries u and method tags the verifier looks up by name', () => {
    const e = auth()
    const byName = (n: string) => e.tags.find((t) => t[0] === n)?.[1]
    expect(byName('u')).toBe(URL_)
    expect(byName('method')).toBe('POST')
  })

  it('uppercases the method (the verifier compares case-insensitively)', () => {
    expect(auth({ method: 'post' }).tags.find((t) => t[0] === 'method')?.[1]).toBe('POST')
  })

  it('adds a payload tag with sha256 of the body when one is sent', () => {
    const body = '{"hello":"world"}'
    const e = auth({ body })
    expect(e.tags.find((t) => t[0] === 'payload')?.[1]).toBe(
      bytesToHex(sha256(utf8ToBytes(body))),
    )
  })

  it('omits the payload tag entirely when there is no body', () => {
    expect(auth().tags.some((t) => t[0] === 'payload')).toBe(false)
  })

  /**
   * The regression that matters. `created_at` has one-second resolution, so
   * without a nonce two identical requests inside the same second produce a
   * byte-identical event — and the relay rejects the second with
   * `NIP-98: replay detected` (observed live before this fix).
   */
  it('produces a unique event id for identical requests in the same second', () => {
    const now = 1_753_300_200_000
    const a = auth({ nowMs: now, body: 'same' })
    const b = auth({ nowMs: now, body: 'same' })
    expect(a.created_at).toBe(b.created_at)
    expect(a.id).not.toBe(b.id)
  })

  it('is deterministic when the nonce is pinned, proving the nonce is the only variable', () => {
    const args = { nowMs: 1_753_300_200_000, body: 'same', nonce: 'fixed' }
    expect(auth(args).id).toBe(auth(args).id)
  })

  it('formats the header as `Nostr <base64 event json>`', () => {
    const header = authorizationHeader({
      pubkey: PUBKEY,
      secretKeyHex: SECRET,
      url: URL_,
      method: 'POST',
    })
    expect(header.startsWith('Nostr ')).toBe(true)
    const decoded = JSON.parse(atob(header.slice('Nostr '.length)))
    expect(decoded.kind).toBe(27235)
    expect(decoded.pubkey).toBe(PUBKEY)
  })

  it('strips trailing slashes but keeps loopback hosts distinct', () => {
    expect(normalizeUrl('http://localhost:3000/events/')).toBe('http://localhost:3000/events')
    // The relay deliberately does NOT alias these — the u-tag host is the
    // community binding, so collapsing them would be a host-binding side door.
    expect(normalizeUrl('http://localhost:3000/events')).not.toBe(
      normalizeUrl('http://127.0.0.1:3000/events'),
    )
  })
})
