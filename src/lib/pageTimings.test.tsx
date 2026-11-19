// @vitest-environment jsdom
/**
 * Peek's page-open timings, read at the wire: the body that would leave the
 * browser for Estiva ID. The wait ends when the live page is there; the saved
 * picture is a second number. The timer's own rules (quiet spell, hidden tabs,
 * allowance, the sign-in pass) are `@estiva-app/platform`'s, tested there;
 * here, which navigations in Peek start one, and what Peek adds to a load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import indexHtml from '../../index.html?raw'

// The sign-in's own token handling is @estiva-app/identity's, tested there; here a signed-in QA-1.
const leaving = new Set<() => void>()
vi.mock('@/auth/estivaId', () => ({
  ESTIVA_ID_ORIGIN: 'https://id.estiva.app',
  currentEstivaToken: () => 'qa-1-token',
  onLeavingForSignIn: (listener: () => void) => {
    leaving.add(listener)
    return () => leaving.delete(listener)
  },
}))

const PLANTED_TITLE = 'plantedtitle board offsite'
const TOPIC = '/app/teams/plantedslug-9c69f247'

let requests: Array<{ url: string; body: string }>
let stopTimings: (() => void) | undefined

/** MutationObserver callbacks and the token read are microtasks. */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/** The live page draws a loading placeholder in its main area, then the page itself. */
async function load(ms: number) {
  const main = document.createElement('main')
  main.innerHTML = '<div class="animate-pulse h-4"></div>'
  document.body.replaceChildren(main)
  await flush()
  vi.advanceTimersByTime(ms)
  main.innerHTML = `<h1>${PLANTED_TITLE}</h1>`
  await flush()
  vi.advanceTimersByTime(1000)
  await flush()
}

const bodies = () => requests.map((r) => JSON.parse(r.body))

async function start() {
  const { startPageTimings } = await import('./pageTimings')
  stopTimings = startPageTimings()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  leaving.clear()
  sessionStorage.clear()
  localStorage.clear()
  delete window.__peekPicture
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      requests.push({ url, body: init.body })
      return new Response(null, { status: 202 })
    }),
  )
  window.history.replaceState({}, '', '/app/desk')
  document.head.replaceChildren()
  document.body.replaceChildren()
})

afterEach(() => {
  stopTimings?.()
  stopTimings = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Starts the timer on a load that drew nothing, so the test starts clean. */
async function startClean() {
  await start()
  vi.advanceTimersByTime(5000)
  await flush()
  requests = []
}

describe('Peek page-open timings', () => {
  it('a new tab that drew the saved picture sends the wait until the live page, and when the picture showed apart', async () => {
    window.__peekPicture = { shownAt: 0 } // drawn by index.html before the app
    await start()
    await load(1800) // the live page under the picture, ready at 1800
    expect(bodies()).toEqual([
      {
        release: expect.any(String),
        screen: '/app/desk',
        how: 'new-tab',
        waitMs: 1800,
        ready: 'placeholder-gone',
        pictureMs: 0,
      },
    ])
    expect(requests[0]?.url).toBe('https://id.estiva.app/timing')
  })

  it('a saved picture still up after the live page drew holds the wait until it goes, as the person sees it', async () => {
    // The picture exactly as index.html draws it, before the app starts.
    localStorage.setItem('peek.estivaId.token', JSON.stringify({ pubkey: 'qa1' }))
    localStorage.setItem('peek-device-copy-owner', 'wss://relay|qa1')
    localStorage.setItem(
      'peek-desk-picture',
      JSON.stringify({ owner: 'wss://relay|qa1', css: '/assets/app.css', html: '<main><h1>Saved desk</h1></main>' }),
    )
    document.head.innerHTML = '<link rel="stylesheet" href="/assets/app.css">'
    document.body.innerHTML = '<div id="root"></div>'
    const script = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].find((m) => m[1]?.includes('peek-picture'))
    new Function(script?.[1] ?? 'throw new Error("index.html draws no picture")')()
    expect(document.getElementById('peek-picture')).not.toBeNull()
    await start()
    const root = document.getElementById('root') as HTMLElement
    root.innerHTML = '<main><div class="animate-pulse h-4"></div></main>'
    await flush()
    vi.advanceTimersByTime(1800)
    root.innerHTML = `<main><h1>${PLANTED_TITLE}</h1></main>` // drawn under the picture
    await flush()
    vi.advanceTimersByTime(150)
    const { revealLivePage } = await import('./pagePicture')
    revealLivePage() // the picture goes 150 ms later, once the live page has settled
    await flush()
    vi.advanceTimersByTime(1000)
    await flush()
    expect(bodies().map((b) => [b.waitMs, b.pictureMs])).toEqual([[1950, 0]])
  })

  it('a new tab with no saved picture sends no picture number', async () => {
    await start()
    await load(900)
    expect(bodies().map((b) => [b.waitMs, 'pictureMs' in b])).toEqual([[900, false]])
  })

  it('times a conversation opened by a link, named by its route, with none of the planted text', async () => {
    window.__peekPicture = { shownAt: 0 }
    await startClean()
    window.history.pushState(null, '', TOPIC) // as React Router writes it, before the page draws
    await load(700)
    expect(bodies()).toEqual([
      { release: expect.any(String), screen: '/app/teams/:id', how: 'in-app', waitMs: 700, ready: 'placeholder-gone' },
    ])
    expect(requests[0]?.body).not.toMatch(/planted|offsite|9c69f247/)
  })

  it('starts no timing for a redirect in place or a change of query alone', async () => {
    await startClean()
    window.history.replaceState(null, '', TOPIC)
    await load(300)
    window.history.pushState(null, '', `${TOPIC}?message=abc`)
    await load(300)
    expect(requests).toEqual([])
  })

  it("times the browser's own back button", async () => {
    await startClean()
    window.history.pushState(null, '', TOPIC)
    await load(100)
    window.history.pushState(null, '', '/app/teams')
    await load(100)
    requests = []
    window.history.replaceState({}, '', TOPIC) // the browser moves the address, then fires popstate
    window.dispatchEvent(new PopStateEvent('popstate'))
    await load(400)
    expect(bodies().map((b) => [b.screen, b.how, b.waitMs])).toEqual([['/app/teams/:id', 'in-app', 400]])
  })

  it('leaving for sign-in while a page loads sends nothing and keeps the open for the page the tab comes back to', async () => {
    await start()
    document.body.innerHTML = '<main><div class="animate-pulse"></div></main>'
    await flush()
    for (const leave of leaving) leave()
    vi.advanceTimersByTime(60_000)
    await flush()
    expect(requests).toEqual([])
    expect(JSON.parse(sessionStorage.getItem('estiva.pageTimer.carried') ?? 'null')).toMatchObject({ how: 'new-tab' })
  })
})
