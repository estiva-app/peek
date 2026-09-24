// @vitest-environment jsdom
/**
 * PEE-8 — the tab's single live client.
 *
 * The React wiring in `useLiveClient` is thin on purpose; what is worth testing
 * is what this module guarantees to it: one connection per tab, a credential
 * read per connect rather than captured, and a state seam for PEE-9.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLiveTopics,
  installWideFilterDiagnostic,
  relayLog,
  resetLiveTopicsForTests,
  wideFilterDeliveryLog,
  type WideFilterSnapshot,
} from './liveTopics'

const CHANNEL = '11111111-1111-4111-8111-111111111111'
const CHANNEL_B = '22222222-2222-4222-8222-222222222222'

/** Count sockets by stubbing the global the client reaches for. */
let sockets: { url: string; closed: boolean }[] = []

beforeEach(() => {
  sockets = []
  vi.stubGlobal(
    'WebSocket',
    class {
      onopen: unknown = null
      onmessage: unknown = null
      onclose: unknown = null
      onerror: unknown = null
      constructor(url: string) {
        sockets.push({ url, closed: false })
      }
      send() {}
      close() {
        const s = sockets[sockets.length - 1]
        if (s) s.closed = true
      }
    },
  )
  sessionStorage.clear()
})

afterEach(() => {
  resetLiveTopicsForTests()
  vi.unstubAllGlobals()
})

describe('one connection per tab', () => {
  it('opens a single socket however many callers ask', () => {
    // The property the whole design rests on: max_subscriptions is per
    // connection and the relay authenticates a connection once, so a second
    // socket would double the AUTH round trips for nothing.
    getLiveTopics('https://relay.test')
    getLiveTopics('https://relay.test')
    getLiveTopics('https://relay.test')
    expect(sockets).toHaveLength(1)
  })

  it('converts the https relay origin to wss', () => {
    getLiveTopics('https://relay.test')
    expect(sockets[0]?.url).toBe('wss://relay.test')
  })

  it('returns the same instance rather than rebuilding', () => {
    expect(getLiveTopics('https://relay.test')).toBe(getLiveTopics('https://relay.test'))
  })

  it('replaces the client when the relay origin changes', () => {
    // A different origin is a different deployment; leaving a socket pointed at
    // the old one would be worse than the reconnect.
    getLiveTopics('https://relay.test')
    getLiveTopics('https://other.test')
    expect(sockets).toHaveLength(2)
    expect(sockets[0]?.closed).toBe(true)
    expect(sockets[1]?.url).toBe('wss://other.test')
  })
})

describe('watchChannels — the sidebar’s wide filter (SHR-5)', () => {
  it('takes a whole sidebar of channels on the one connection, and stops idempotently', () => {
    const live = getLiveTopics('https://relay.test')
    const many = Array.from(
      { length: 26 },
      (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
    )
    const watch = live.watchChannels(many, () => {})
    expect(sockets).toHaveLength(1)
    watch.stop()
    expect(() => watch.stop()).not.toThrow()
  })

  /*
    What is deliberately not asserted here: the REQ's filters. No frame is sent
    until the socket has connected and AUTHed, which this stub does not drive,
    and the frame's shape is `@estiva-app/platform`'s contract rather than
    Peek's — `watchFolders` chunks at `MAX_FOLDERS_PER_SUBSCRIPTION` and is
    tested there. That the hook hands over every channel it lists is pinned in
    `api/useTeamUnread.test.tsx`.

    And the half neither repository can assert: whether the relay fans a wide
    filter out at all. A build with the singular
    `extract_channel_ids_from_filters` accepts the identical frame and delivers
    nothing — EOSE, `live`, silence. It needs a signed-in person against
    production, which is why the interval fallback stays armed.
  */
})

describe('the log says when a live path stopped (FOL-40)', () => {
  /*
    The console is the only place a refused subscription shows, and the
    client's log is `console.debug`, which the browser hides at its default
    level. Three rounds of FOL-40 were spent on a question one visible line
    would have answered, so the lines that mean "this stopped working" are
    warnings and the rest stays quiet.
  */
  it('warns for a refusal and stays quiet for a trace', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    try {
      relayLog('folder subscription closed', { reason: 'rate-limited: quota exceeded' })
      relayLog('no credential; deferring auth')
      relayLog('relay refused the auth event', { reason: 'restricted' })
      expect(warn).toHaveBeenCalledTimes(3)

      relayLog('authenticated', { subscriptions: 3 })
      relayLog('reconnecting', { attempt: 1 })
      expect(debug).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenCalledTimes(3)
    } finally {
      warn.mockRestore()
      debug.mockRestore()
    }
  })

  it('says how many Folders a wide filter asked for', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const live = getLiveTopics('https://relay.test')
      live.watchChannels([CHANNEL, CHANNEL_B], () => {}).stop()
      expect(info).toHaveBeenCalledWith('[relay] watching 2 folder(s) for kinds 9, 1111')
    } finally {
      info.mockRestore()
    }
  })

  /*
    And says when one *delivers*, which is the question the subscription line
    could not answer. "Was the REQ accepted?" is answered by the absence of a
    closure, and it is the wrong question: a filter naming many distinct `#h`
    values is classified as a global subscription on a relay build carrying the
    singular `extract_channel_id_from_filters`, and a global subscription is
    never handed an event that carries a channel. The frame is identical, the
    acceptance is identical, and the delivery is zero.

    So the wording is the artefact, and it is pinned here. Elapsed tells a
    backfilled event from a live one — the REQ carries no `since`, so stored
    events arrive within a moment of subscribing and a live one arrives when
    somebody speaks. The watch size gives the console its own control, because
    a single-Folder watch is channel-scoped on every build.
  */
  it('summarises stored history in one line and names every live delivery', () => {
    /*
      The first cut of this counted deliveries and stopped at 25, which is the
      wrong axis: production delivered its whole stored page in 2 ms, so the
      budget was gone 221 ms after subscribing and the console proved only that
      the REQ matched something — which was never in doubt. History and live
      differ by three orders of magnitude in volume, so they are counted apart.
    */
    vi.useFakeTimers()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const log = wideFilterDeliveryLog(81)
      // The page, as production delivers it: dozens, inside a couple of ms.
      for (let i = 0; i < 40; i++) log.record(CHANNEL)
      expect(info).not.toHaveBeenCalled()

      vi.advanceTimersByTime(3_000)
      expect(info).toHaveBeenCalledExactlyOnceWith(
        '[relay] wide filter of 81: 40 stored event(s) in the first 3000ms. Anything below this line arrived live.',
      )

      // And the one line the whole exercise exists for.
      info.mockClear()
      vi.advanceTimersByTime(181_000)
      log.record(CHANNEL_B)
      expect(info).toHaveBeenCalledExactlyOnceWith(
        `[relay] wide filter of 81 delivered LIVE #1 for ${CHANNEL_B}, 184000ms after subscribing`,
      )
      // A watch outlives the test otherwise: `__wideFilters()` lists the live
      // ones, so a log left open here is a phantom entry in the next test.
      log.stop()
    } finally {
      info.mockRestore()
      vi.useRealTimers()
    }
  })

  it('answers on demand, so a reading does not depend on the scrollback', () => {
    /*
      Three readings in a row were lost to the console rather than to the bug:
      the wrong page was open, so the 81-Folder watch never existed; the paste
      stopped above the line; the cap had already fired. A snapshot needs none
      of that — `live: 0` here, beside a non-zero `live` on a 1-Folder watch,
      is FOL-40's remaining question answered outright.
    */
    vi.useFakeTimers()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    installWideFilterDiagnostic()
    const read = () =>
      (window as unknown as { __wideFilters: () => WideFilterSnapshot[] }).__wideFilters()
    try {
      const wide = wideFilterDeliveryLog(81)
      const one = wideFilterDeliveryLog(1)
      wide.record(CHANNEL)
      expect(read()).toEqual([
        expect.objectContaining({ folders: 81, stored: 1, live: 0 }),
        expect.objectContaining({ folders: 1, stored: 0, live: 0 }),
      ])

      vi.advanceTimersByTime(60_000)
      one.record(CHANNEL_B)
      const [team, file] = read()
      expect(team).toMatchObject({ folders: 81, stored: 1, live: 0 })
      expect(team.lastLive).toBeUndefined()
      expect(file).toMatchObject({ folders: 1, live: 1 })
      expect(file.lastLive?.folder).toBe(CHANNEL_B)

      // A stopped watch leaves nothing behind to read.
      wide.stop()
      one.stop()
      expect(read()).toEqual([])
    } finally {
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
  })

  it('does not read a replayed page as a live burst', () => {
    /*
      The instrument's own defect, found before it cost a wrong fix. A
      reconnect re-issues the REQ, a re-issued REQ carries no `since`, and the
      relay replays its stored page — minutes after the watch was created, so
      every one of those lands outside the original window. Production showed
      77 of them in 7ms for a single Folder and they read as a fan-out storm.
    */
    vi.useFakeTimers()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const log = wideFilterDeliveryLog(81)
      for (let i = 0; i < 40; i++) log.record(CHANNEL)
      vi.advanceTimersByTime(3_000)

      // Thirteen seconds in, the socket comes back and the page arrives again.
      vi.advanceTimersByTime(10_000)
      log.resubscribed()
      info.mockClear()
      for (let i = 0; i < 77; i++) log.record(CHANNEL)

      installWideFilterDiagnostic()
      const [snapshot] = (
        window as unknown as { __wideFilters: () => WideFilterSnapshot[] }
      ).__wideFilters()
      expect(snapshot).toMatchObject({ live: 0, stored: 77, resubscribes: 1 })
      expect(info).not.toHaveBeenCalled()

      // And the window it opened still closes, so the ruler is redrawn.
      vi.advanceTimersByTime(3_000)
      expect(info).toHaveBeenCalledExactlyOnceWith(
        '[relay] wide filter of 81: 77 stored event(s) in the first 3000ms. Anything below this line arrived live.',
      )
      log.stop()
    } finally {
      info.mockRestore()
      vi.useRealTimers()
    }
  })

  it('does not leave the summary pending once the watch is stopped', () => {
    vi.useFakeTimers()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      wideFilterDeliveryLog(81).stop()
      vi.advanceTimersByTime(10_000)
      expect(info).not.toHaveBeenCalled()
    } finally {
      info.mockRestore()
      vi.useRealTimers()
    }
  })
})

describe('the state seam', () => {
  it('reports a state and notifies listeners', () => {
    const live = getLiveTopics('https://relay.test')
    expect(['connecting', 'authenticating', 'live', 'reconnecting', 'failed']).toContain(
      live.state(),
    )
    const seen: string[] = []
    const off = live.onState((s) => seen.push(s))
    expect(typeof off).toBe('function')
    off()
  })

  it('stops notifying after unsubscribe', () => {
    const live = getLiveTopics('https://relay.test')
    const listener = vi.fn()
    live.onState(listener)()
    // Nothing has driven a transition, but the contract is that the returned
    // function removes the listener rather than being decorative.
    expect(listener).not.toHaveBeenCalled()
  })
})
