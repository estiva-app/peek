/**
 * CON-20: let an app's own reader talk to `con20-fake-relay.ts`.
 *
 * Estiva ID refuses to sign a NIP-98 header for a localhost URL ("not an allowed
 * NIP-98 destination"), which is right, and the fake relay checks no header. So
 * this answers exactly that request — `POST …/sign` of a `kind:27235` whose `u`
 * is on localhost — with the event unsigned (id computed, zero signature), and
 * passes every other request through untouched. Import it first.
 */
import { computeEventId } from '@estiva-app/protocol'
import type { UnsignedEvent } from '@estiva-app/protocol'

/** Estiva ID fills in `pubkey` when a signer leaves it out (`@estiva-app/identity` does); the agent's, by default. */
const READER = process.env.CON20_READER_PUBKEY ?? 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'

const real = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.endsWith('/sign') && typeof init?.body === 'string') {
    const { event } = JSON.parse(init.body) as { event?: UnsignedEvent }
    const u = event?.tags.find((t) => t[0] === 'u')?.[1] ?? ''
    if (event?.kind === 27235 && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u)) {
      const full = { ...event, pubkey: event.pubkey || READER }
      const signed = { ...full, id: computeEventId(full), sig: '0'.repeat(128) }
      return new Response(JSON.stringify({ event: signed }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  }
  return real(input, init)
}) as typeof fetch
