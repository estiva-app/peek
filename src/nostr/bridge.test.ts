import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@estiva-app/identity', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // A fresh signature per call, as Estiva ID gives, so a test can tell one ask's auth from the next.
  signViaEstivaId: vi.fn(async (event: object) => ({ ...event, id: 'id', sig: `sig-${(signatures.count += 1)}` })),
}))
vi.mock('./deviceCopy', () => ({ keepRelayAnswer: vi.fn() }))
const signatures = vi.hoisted(() => ({ count: 0 }))

import { publishSigned, queryRelay, setSocketReader, type SocketReader } from './bridge'
import { describeRelayFailure, RelayReadError } from './relayRead'

const ME = 'a'.repeat(64)
type Answer = { ok: boolean; events: never[] }

/*
  A read the loader sends over HTTP cannot be taken back once it is on the wire,
  and a click 1 s after Desk that found one there drew 200–300 ms later (PEE-5).
  So it waits until the person's own reads have been quiet for 2 s, at most 8 s.
*/
describe("the loader's HTTP reads (PEE-5)", () => {
  let posts: number[]

  beforeEach(() => {
    vi.useFakeTimers()
    posts = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        posts.push(Date.now())
        return new Response('[]', { status: 200 })
      }),
    )
  })

  afterEach(() => {
    setSocketReader(null)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  /** The socket answers a click when the test says so, and hands every `ahead` read to HTTP. */
  function socketHoldingClicks() {
    const open: ((answer: Answer) => void)[] = []
    const reader: SocketReader = async (_relay, _filters, _pubkey, { lane } = {}) =>
      lane === 'ahead' ? null : new Promise<Answer>((resolve) => open.push(resolve))
    setSocketReader(reader)
    return { answerClicks: () => open.splice(0).forEach((resolve) => resolve({ ok: true, events: [] })) }
  }

  it('waits while a click read is open, then for 2 s of quiet', async () => {
    const socket = socketHoldingClicks()
    const click = queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    const ahead = queryRelay('https://relay', [{ kinds: [1] }], 'token', ME, 'ahead')

    await vi.advanceTimersByTimeAsync(1_500)
    expect(posts).toHaveLength(0)
    socket.answerClicks()
    await vi.advanceTimersByTimeAsync(1_800)
    expect(posts).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(400)
    expect(posts).toHaveLength(1)
    await expect(ahead).resolves.toMatchObject({ ok: true })
    await click
  })

  it('goes after 8 s however busy the click lane stays', async () => {
    const socket = socketHoldingClicks()
    const click = queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    const ahead = queryRelay('https://relay', [{ kinds: [1] }], 'token', ME, 'ahead')

    await vi.advanceTimersByTimeAsync(7_800)
    expect(posts).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(400)
    expect(posts).toHaveLength(1)
    await expect(ahead).resolves.toMatchObject({ ok: true })
    socket.answerClicks()
    await click
  })

  it('goes at once when the person joins it while it waits', async () => {
    const socket = socketHoldingClicks()
    const click = queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    let lane: 'ahead' | 'click' = 'ahead'
    const ahead = queryRelay('https://relay', [{ kinds: [1] }], 'token', ME, () => lane)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(posts).toHaveLength(0)
    lane = 'click'
    await vi.advanceTimersByTimeAsync(200)
    expect(posts).toHaveLength(1)
    await expect(ahead).resolves.toMatchObject({ ok: true })
    socket.answerClicks()
    await click
  })

  it("never holds a click's own HTTP read", async () => {
    socketHoldingClicks()
    const busy = queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    setSocketReader(async () => null)
    const click = queryRelay('https://relay', [{ kinds: [7] }], 'token', ME)

    await vi.advanceTimersByTimeAsync(0)
    expect(posts).toHaveLength(1)
    await expect(click).resolves.toMatchObject({ ok: true })
    void busy
  })
})

/*
  A relay too busy to answer says so with a 503 (a 502 from the proxy while it
  restarts). Peek asks again quietly, as the protocol's client does, and only a
  relay that stays busy reaches the person, in the same words as every app.
  why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-busy-relay-says-it-is-busy.md
*/
describe('a busy relay (APP-9)', () => {
  type Answer = () => Response
  const json = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => () =>
    new Response(JSON.stringify(body), { status, headers })
  const BUSY = json(503, { error: 'relay busy, retry shortly' })
  const EVENT = { id: 'e1', kind: 9 }

  /** The relay answers each ask in turn, the last answer for every ask after; what each ask sent is kept. */
  function relayAnswering(...answers: Answer[]) {
    const asks: { path: string; auth: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
        asks.push({ path: new URL(url).pathname, auth: init.headers.authorization })
        return answers[Math.min(asks.length - 1, answers.length - 1)]()
      }),
    )
    return asks
  }

  /** What the person reads when a read fails for `reason`. */
  const lineFor = (reason: string) => describeRelayFailure(new RelayReadError(reason).kind)

  beforeEach(() => {
    vi.useFakeTimers()
    setSocketReader(null)
  })

  afterEach(() => {
    setSocketReader(null)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('is asked again quietly over HTTP, each time with fresh auth, and the read draws what it then sends', async () => {
    const asks = relayAnswering(BUSY, () => new Response('Bad Gateway', { status: 502 }), json(200, [EVENT]))
    const read = queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(read).resolves.toMatchObject({ ok: true, events: [EVENT] })
    expect(asks).toHaveLength(3)
    expect(new Set(asks.map((ask) => ask.auth)).size).toBe(3)
  })

  it('a read the relay stays busy for is asked four times, then shows what was already saved', async () => {
    const asks = relayAnswering(BUSY)
    const read = queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    await vi.advanceTimersByTimeAsync(10_000)
    const answer = await read
    expect(answer).toMatchObject({ ok: false, events: [] })
    expect(lineFor(answer.reason ?? '')).toBe('Could not reach the relay. Showing what was already saved.')
    expect(asks).toHaveLength(4)
    expect(new Set(asks.map((ask) => ask.auth)).size).toBe(4)
  })

  it('a busy relay that names a wait (Retry-After) is not asked again before it', async () => {
    const asks = relayAnswering(json(503, { error: 'relay busy, retry shortly' }, { 'retry-after': '5' }), json(200, [EVENT]))
    const read = queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    await vi.advanceTimersByTimeAsync(4_900)
    expect(asks).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(read).resolves.toMatchObject({ ok: true, events: [EVENT] })
    expect(asks).toHaveLength(2)
  })

  it('a quota refusal sent as a 503 is asked once, not as busy, and reads as the relay being busy', async () => {
    const asks = relayAnswering(json(503, { error: 'rate-limited: quota exceeded; retry in 8s' }))
    const read = queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    await vi.advanceTimersByTimeAsync(10_000)
    const answer = await read
    expect(asks).toHaveLength(1)
    expect(answer.ok).toBe(false)
    expect(lineFor(answer.reason ?? '')).toBe('The relay is busy right now. Showing what was already saved, and asking again shortly.')
  })

  it("a loader's read ahead asks a busy relay once and leaves it alone", async () => {
    setSocketReader(async () => null)
    const asks = relayAnswering(BUSY)
    const ahead = queryRelay('https://relay', [{ kinds: [1] }], 'token', ME, 'ahead')
    await vi.advanceTimersByTimeAsync(20_000)
    await expect(ahead).resolves.toMatchObject({ ok: false, events: [] })
    expect(asks).toHaveLength(1)
  })

  it('a write the relay stays busy for is posted four times with fresh auth, and fails in words the person can read', async () => {
    const asks = relayAnswering(BUSY)
    const result = publishSigned('https://relay', { id: 'e2', kind: 9 } as never, 'token', ME)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(result).resolves.toEqual({ ok: false, reason: 'the relay is busy, try again in a moment', httpStatus: 503 })
    expect(asks.map((ask) => ask.path)).toEqual(['/events', '/events', '/events', '/events'])
    expect(new Set(asks.map((ask) => ask.auth)).size).toBe(4)
  })
})
