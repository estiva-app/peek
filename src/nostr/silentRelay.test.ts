/**
 * 5cd7579f — a relay that takes a read and never answers.
 *
 * On 24 Nov the speed kit reopened the Desk as QA-1 on such a relay: after 90 s Peek showed the copy as current, the
 * rail said nothing, and 34 reads over HTTP were still waiting. These go through the real bridge and the real freshness
 * state, with only the network faked, and assert what the rail's dot would say.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@estiva-app/identity', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  signViaEstivaId: vi.fn(async (event: object) => ({ ...event, id: 'id', sig: 'sig' })),
}))
vi.mock('./deviceCopy', () => ({ keepRelayAnswer: vi.fn() }))
vi.mock('@/lib/failureReports', () => ({ heardRefusal: () => {} }))

import { publishSigned, queryRelay, setSocketReader } from './bridge'
import {
  currentObservation,
  deriveFreshness,
  describeFreshness,
  recordRelayState,
  resetFreshnessForTests,
} from './freshness'
import { relayFailureKind } from './relayRead'

/** The 15 s an HTTP read waits for an answer, after the socket's 10 s: Miky's "about 25 s" in the kickoff. */
const READ_ANSWER_TIMEOUT_MS = 15_000
/** Whether a promise has settled by now, without waiting on one that never will. */
const settledNow = <T>(promise: Promise<T>) => Promise.race([promise, Promise.resolve('still waiting' as const)])

const ME = 'a'.repeat(64)

/** What the rail's dot says now: nothing (`null`) or its words. */
function dot(): string | null {
  const state = deriveFreshness(currentObservation())
  return state.kind === 'live' || state.kind === 'idle' ? null : describeFreshness(state, Date.now())
}

/** A relay whose HTTP reads hang until `answer()`, as the kit's silent.js makes it; an abort rejects as a browser's does. */
function silentHttp() {
  const waiting: ((response: Response) => void)[] = []
  const fetch = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        waiting.push(resolve)
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
  )
  vi.stubGlobal('fetch', fetch)
  return { fetch, answer: () => waiting.splice(0).forEach((resolve) => resolve(new Response('[]', { status: 200 }))) }
}

beforeEach(() => {
  vi.useFakeTimers()
  resetFreshnessForTests()
  // The socket is up and authenticated: the relay took the AUTH, so Peek's own state says live.
  recordRelayState('live')
})

afterEach(() => {
  setSocketReader(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a read the relay never answers', () => {
  it('ends after the set time and turns the dot amber with words, on a live socket', async () => {
    silentHttp()
    const read = queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    const failed = read.catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(READ_ANSWER_TIMEOUT_MS - 1_000)
    expect(dot()).toBeNull()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(dot()).toBe("The relay isn't answering. Showing saved data, not yet synced.")
    expect(relayFailureKind(await settledNow(failed))).toBe('silent')
  })

  it('is never drawn as an empty answer: the read rejects rather than resolving with no events', async () => {
    silentHttp()
    const settled = queryRelay('https://relay', [{ kinds: [9] }], 'token', ME).then(
      (answer) => ({ resolved: answer }),
      () => 'rejected',
    )
    await vi.advanceTimersByTimeAsync(READ_ANSWER_TIMEOUT_MS)
    expect(await settledNow(settled)).toBe('rejected')
  })

  it('keeps saying so however long the relay stays silent', async () => {
    silentHttp()
    void queryRelay('https://relay', [{ kinds: [9] }], 'token', ME).catch(() => {})
    await vi.advanceTimersByTimeAsync(READ_ANSWER_TIMEOUT_MS + 10 * 60_000)
    expect(dot()).toMatch(/^The relay isn't answering\./)
  })

  it('says when the relay last answered', async () => {
    const http = silentHttp()
    const first = queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    await vi.advanceTimersByTimeAsync(0)
    http.answer()
    await first
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    void queryRelay('https://relay', [{ kinds: [9] }], 'token', ME).catch(() => {})
    await vi.advanceTimersByTimeAsync(READ_ANSWER_TIMEOUT_MS)
    expect(dot()).toBe("The relay isn't answering. Showing saved data, synced 2 minutes ago.")
  })
})

describe('a refusal before the silence', () => {
  it('is not a sync: the words do not say it synced just now', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'restricted: not a member' }), { status: 403 })))
    await queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    silentHttp()
    void queryRelay('https://relay', [{ kinds: [9] }], 'token', ME).catch(() => {})
    await vi.advanceTimersByTimeAsync(READ_ANSWER_TIMEOUT_MS)
    expect(dot()).toBe("The relay isn't answering. Showing saved data, not yet synced.")
  })
})

describe('a slow relay that answers', () => {
  it('never shows the dot for a read answered just inside the set time', async () => {
    const http = silentHttp()
    const read = queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    await vi.advanceTimersByTimeAsync(READ_ANSWER_TIMEOUT_MS - 100)
    http.answer()
    await expect(read).resolves.toMatchObject({ ok: true })
    await vi.advanceTimersByTimeAsync(READ_ANSWER_TIMEOUT_MS)
    expect(dot()).toBeNull()
  })
})

describe('the relay answering again', () => {
  it('clears the dot with the next HTTP answer', async () => {
    const http = silentHttp()
    void queryRelay('https://relay', [{ kinds: [9] }], 'token', ME).catch(() => {})
    await vi.advanceTimersByTimeAsync(READ_ANSWER_TIMEOUT_MS)
    expect(dot()).not.toBeNull()

    const again = queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    await vi.advanceTimersByTimeAsync(0)
    http.answer()
    await again
    expect(dot()).toBeNull()
  })

  it('clears the dot with the next answer over the socket', async () => {
    silentHttp()
    void queryRelay('https://relay', [{ kinds: [9] }], 'token', ME).catch(() => {})
    await vi.advanceTimersByTimeAsync(READ_ANSWER_TIMEOUT_MS)
    expect(dot()).not.toBeNull()

    setSocketReader(async () => ({ ok: true, events: [] }))
    await queryRelay('https://relay', [{ kinds: [9] }], 'token', ME)
    expect(dot()).toBeNull()
  })
})

describe('a publish', () => {
  it('is not cut by the read timeout', async () => {
    const http = silentHttp()
    const sent = publishSigned('https://relay', { id: 'e', pubkey: ME, kind: 9, tags: [], content: '', created_at: 1, sig: 's' }, 'token', ME)
    await vi.advanceTimersByTimeAsync(READ_ANSWER_TIMEOUT_MS * 2)
    expect(dot()).toBeNull()
    http.answer()
    await expect(sent).resolves.toBeDefined()
  })
})
