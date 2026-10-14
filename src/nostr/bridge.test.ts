import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@estiva-app/identity', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  signViaEstivaId: vi.fn(async (event: object) => ({ ...event, id: 'id', sig: 'sig' })),
}))
vi.mock('./deviceCopy', () => ({ keepRelayAnswer: vi.fn() }))

import { queryRelay, setSocketReader, type SocketReader } from './bridge'

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
        return { status: 200, text: async () => '[]' }
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
