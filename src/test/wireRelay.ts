/**
 * A fake relay and a fake Estiva ID, at the HTTP boundary (UNI-7).
 *
 * The wire tests (`src/wire/*.wire.test.tsx`) run Peek's real write path —
 * the hook a control calls, the builder, the bridge, NIP-98, the publish
 * parser — and stop only at `fetch`. What the relay was sent is then read off
 * this fake, the way the real relay would see it. The bridge-mocked tests next
 * to each builder check an event one step before it leaves; these check that
 * the person's action produces it, in order, and that a refusal stops what it
 * should. Modelled on Ship's `scripts/*.test.ts`, which caught 6 of Ship's 13
 * planted bugs that nothing else did (PEE-50).
 *
 * It answers:
 *   - `POST <relay>/events` — records the event, answers `200 {accepted}`, or
 *     `accepted:false` when a `refuse` rule matches. An accepted event is kept,
 *     so a later query finds it (replaceable kinds replace).
 *   - `POST <relay>/query` — the seeded and accepted events matching the filters.
 *   - `POST <id>/sign` — the event as the token's subject, with its real NIP-01
 *     id, so an id Peek computed itself matches the relay's answer.
 *   - `POST <id>/nip44/encrypt|decrypt` — a reversible stand-in, so a test can
 *     read an encrypted blob back with {@link WireRelay.decrypt}.
 * A relay request without a NIP-98 header for its own URL and body is answered
 * 401, as the relay does. Anything else throws, so a new call is not silently
 * answered.
 */
import { createHash } from 'node:crypto'
import { vi } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'

export const RELAY = 'https://relay.test'
export const ID = 'https://id.estiva.app'
export const ME = 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2'
export const TOKEN = { accessToken: 'wire-token', pubkey: ME }

const CIPHER = 'fake-nip44:'

type Filter = Record<string, unknown>
export interface Refusal {
  /** Which sent event to refuse. */
  when: (event: SignedEvent) => boolean
  /** The relay's `message`. */
  message?: string
  /** Refuse only this many matches, then accept again. */
  times?: number
}

export interface WireRelay {
  /** Every event the relay was sent, in order, refused ones included. */
  readonly sent: SignedEvent[]
  /** Events the relay answers queries from. */
  seed: (...events: SignedEvent[]) => void
  /** Refuse matching events with `200 {accepted:false}`. */
  refuse: (rule: Refusal) => void
  /** The sent events of these kinds, NIP-98 auth excluded (it is never sent as an event). */
  sentOf: (...kinds: number[]) => SignedEvent[]
  /** The plaintext of a {@link WireRelay} ciphertext. */
  decrypt: (ciphertext: string) => string
  /** Forget what was sent and seeded, and the refusals. */
  reset: () => void
}

/** NIP-01's id, as `eventIdOf` in `src/nostr/fileConversation.ts` computes it; sync here, for fixtures. */
export function eventId(event: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }): string {
  return createHash('sha256')
    .update(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))
    .digest('hex')
}

/** A signed event for seeding, with its real id. */
export function signed(partial: Partial<SignedEvent> & { kind: number }, pubkey = ME): SignedEvent {
  const base = { pubkey, created_at: 1_700_000_000, tags: [] as string[][], content: '', ...partial }
  return { ...base, id: partial.id ?? eventId(base), sig: '' } as SignedEvent
}

const replaceable = (kind: number) => kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000) || (kind >= 30000 && kind < 40000)
const dOf = (event: SignedEvent) => event.tags.find((t) => t[0] === 'd')?.[1] ?? ''

function matches(filter: Filter, event: SignedEvent): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (key === 'limit') continue
    if (key === 'ids' && !(value as string[]).includes(event.id)) return false
    if (key === 'authors' && !(value as string[]).includes(event.pubkey)) return false
    if (key === 'kinds' && !(value as number[]).includes(event.kind)) return false
    if (key === 'since' && event.created_at < (value as number)) return false
    if (key === 'until' && event.created_at > (value as number)) return false
    if (key.startsWith('#')) {
      if (!Array.isArray(value)) throw new Error(`wireRelay: ${key} is not a list`)
      const name = key.slice(1)
      if (!event.tags.some((t) => t[0] === name && (value as string[]).includes(t[1]))) return false
    } else if (!['ids', 'authors', 'kinds', 'since', 'until'].includes(key)) {
      // A filter the fake cannot evaluate must not match everything.
      throw new Error(`wireRelay: cannot evaluate filter key ${key}`)
    }
  }
  return true
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Stub `fetch` and `WebSocket` with a fresh fake; call it in each `beforeEach`, so no stub outlives a test. */
export function installWireRelay(): WireRelay {
  const sent: SignedEvent[] = []
  let held: SignedEvent[] = []
  let refusals: Refusal[] = []

  const hold = (event: SignedEvent) => {
    if (replaceable(event.kind)) {
      held = held.filter((e) => !(e.kind === event.kind && e.pubkey === event.pubkey && dOf(e) === dOf(event)))
    }
    held.push(event)
  }

  const authorised = (url: string, body: string, header: string | null): boolean => {
    if (!header?.startsWith('Nostr ')) return false
    try {
      const auth = JSON.parse(Buffer.from(header.slice(6), 'base64').toString('utf8')) as SignedEvent
      const tag = (name: string) => auth.tags.find((t) => t[0] === name)?.[1]
      const payload = createHash('sha256').update(body).digest('hex')
      return auth.kind === 27235 && auth.pubkey === ME && tag('u') === url && tag('method') === 'POST' && tag('payload') === payload
    } catch {
      return false
    }
  }

  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = typeof init?.body === 'string' ? init.body : ''
    const headers = new Headers(init?.headers)

    if (url.startsWith(`${ID}/`)) {
      if (headers.get('authorization') !== `Bearer ${TOKEN.accessToken}`) return json(401, { error: 'unauthorized' })
      const path = url.slice(ID.length)
      const parsed = JSON.parse(body) as Record<string, unknown>
      if (path === '/sign') {
        const unsigned = parsed.event as { kind: number; created_at: number; tags: string[][]; content: string }
        const event = { ...unsigned, pubkey: ME }
        return json(200, { event: { ...event, id: eventId(event), sig: 'f'.repeat(128) } })
      }
      if (path === '/nip44/encrypt') return json(200, { ciphertext: CIPHER + Buffer.from(String(parsed.plaintext)).toString('base64') })
      if (path === '/nip44/decrypt') return json(200, { plaintext: decrypt(String(parsed.ciphertext)) })
    }

    if (url.startsWith(`${RELAY}/`)) {
      if (!authorised(url, body, headers.get('authorization'))) return json(401, { error: 'auth-required: NIP-98' })
      const path = url.slice(RELAY.length)
      if (path === '/events') {
        const event = JSON.parse(body) as SignedEvent
        sent.push(event)
        const rule = refusals.find((r) => r.when(event) && (r.times === undefined || r.times > 0))
        if (rule) {
          if (rule.times !== undefined) rule.times -= 1
          return json(200, { accepted: false, event_id: event.id, message: rule.message ?? 'restricted: refused by the test' })
        }
        hold(event)
        return json(200, { accepted: true, event_id: event.id })
      }
      if (path === '/query') {
        const filters = JSON.parse(body) as Filter[]
        const answer = new Map<string, SignedEvent>()
        for (const filter of filters) {
          const hits = held.filter((event) => matches(filter, event)).sort((a, b) => b.created_at - a.created_at)
          const limited = typeof filter.limit === 'number' ? hits.slice(0, filter.limit) : hits
          for (const event of limited) answer.set(event.id, event)
        }
        return json(200, [...answer.values()])
      }
    }
    throw new Error(`wireRelay: nothing answers ${init?.method ?? 'GET'} ${url}`)
  }

  function decrypt(ciphertext: string): string {
    if (!ciphertext.startsWith(CIPHER)) throw new Error(`wireRelay: not a fake ciphertext: ${ciphertext.slice(0, 40)}`)
    return Buffer.from(ciphertext.slice(CIPHER.length), 'base64').toString('utf8')
  }

  vi.stubGlobal('fetch', vi.fn(fake))
  // The live socket never connects: the tests stay offline, and every read goes over `/query`.
  vi.stubGlobal(
    'WebSocket',
    class {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSING = 2
      static readonly CLOSED = 3
      readyState = 0
      onopen = null
      onclose = null
      onerror = null
      onmessage = null
      addEventListener() {}
      removeEventListener() {}
      send() {}
      close() {}
    },
  )

  return {
    sent,
    seed: (...events) => events.forEach(hold),
    refuse: (rule) => void refusals.push({ ...rule }),
    sentOf: (...kinds) => sent.filter((event) => kinds.includes(event.kind)),
    decrypt,
    reset: () => {
      sent.length = 0
      held = []
      refusals = []
    },
  }
}

/** The first value of a tag. */
export const tagOf = (event: { tags: string[][] }, name: string) => event.tags.find((t) => t[0] === name)?.[1]
/** Every value of a tag. */
export const tagsOf = (event: { tags: string[][] }, name: string) => event.tags.filter((t) => t[0] === name).map((t) => t[1])
