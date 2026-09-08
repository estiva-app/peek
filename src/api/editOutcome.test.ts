/**
 * An edit that did not travel says WHICH HALF refused.
 *
 * The ticket is "A failed publish says nothing about which half refused", in
 * Peek: Feedback & Bugs. Named rather than numbered because its ref is PEE-25
 * and so is the link-marker ticket several files here already cite — refs are
 * not unique across projects (SHI-4).
 *
 * PEE-24 made the failure visible; the message it showed was
 * "the relay did not accept the edit", which was true and told nobody anything
 * they could act on. Signing and publishing fail for unrelated reasons — a
 * credential Estiva ID will not sign with, versus a relay that will not take
 * the event — and one sentence covering both sends people to the wrong service.
 *
 * These pin the shape of the words rather than the wording, and they run
 * against the real `publishSigned`/`signViaEstivaId` seam through `fetch`,
 * because the bug lived in which branch swallowed what.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signViaEstivaId, publishSigned } from '@/nostr/bridge'
import type { UnsignedEvent } from '@estiva-app/protocol'

const unsigned: UnsignedEvent = {
  pubkey: 'a'.repeat(64),
  created_at: 1_756_000_000,
  kind: 40003,
  tags: [['e', 'b'.repeat(64)]],
  content: 'corrected',
}

afterEach(() => vi.unstubAllGlobals())

/** `/sign` answers with a signed event; anything else is the relay. */
function stubBoth(relayBody: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      if (String(url).includes('/sign')) {
        return Response.json({ event: { ...unsigned, kind: 27235, id: 'd'.repeat(64), sig: '0'.repeat(128) } })
      }
      return new Response(JSON.stringify(relayBody), { status })
    }),
  )
}

describe('the two halves fail differently, and the caller can tell', () => {
  /*
    A revoked or expired credential. `/sign` answers 401 and the helper THROWS —
    which is why a caller that only checks a null return misses it entirely.
  */
  it('a refused signature throws, carrying the status and body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('token revoked', { status: 401 })))
    await expect(signViaEstivaId(unsigned, 'stale-token', 'a'.repeat(64))).rejects.toThrow(/401/)
  })

  /*
    The other half. The relay answers, and says no — `publishSigned` resolves
    `{ ok: false, reason }` rather than throwing, so the two failures do not even
    arrive by the same route.
  */
  it('a refused publish resolves with the relay’s own words', async () => {
    // Routed by URL: `publishSigned` signs a NIP-98 auth event of its own
    // first, so a single blunt stub answers the /sign call with the relay's
    // response and the test measures nothing.
    stubBoth({ accepted: false, message: 'restricted: not a channel member' })
    const signed = { ...unsigned, id: 'c'.repeat(64), sig: '0'.repeat(128) }
    const result = await publishSigned('https://relay.test', signed, 'token', 'a'.repeat(64))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('restricted')
  })

  /*
    The trap this exists for: a 200 whose body says no. `accepted` is the
    answer, never the status code — SILENT-FAILURES has this one by name.
  */
  it('a 200 that says accepted:false is still a refusal', async () => {
    stubBoth({ accepted: false, message: 'invalid: bad h tag' }, 200)
    const signed = { ...unsigned, id: 'c'.repeat(64), sig: '0'.repeat(128) }
    const result = await publishSigned('https://relay.test', signed, 'token', 'a'.repeat(64))
    expect(result.ok).toBe(false)
  })
})
