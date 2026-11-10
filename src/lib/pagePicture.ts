/**
 * The saved copy of a page: the markup Peek last drew for a plain Desk, or a
 * plain Topics, kept on the device and shown by `index.html`'s inline script
 * the moment the page arrives, before the app has loaded. The live page
 * replaces it in place once it has drawn, and a click made on it in between is
 * applied then (Miky, 13 Oct: "A new Peek tab draws Desk within 200 ms"; Topics
 * in a new tab or after a reload the same, PEE-4).
 *
 * It is markup, not an image, drawn with the stylesheet the page loads, so it
 * is shown only when that stylesheet is the one it was saved with. It belongs
 * to the person whose copy on the device it sits beside: it is saved under the
 * copy's owner, shown only to them, and removed whenever the copy is
 * (`nostr/deviceCopy.ts`). The inline script reads the same keys and paths:
 * keep the two in step.
 */
import { useEffect } from 'react'

/** The pages a picture is kept of. */
export type PicturePage = 'desk' | 'topics'

/** Where each page's picture is kept, in `localStorage`. */
export const PICTURE_KEYS: Record<PicturePage, string> = { desk: 'peek-desk-picture', topics: 'peek-topics-picture' }

/** Whether a location is the plain page a picture is of: nothing open, no query. */
function isPlain(page: PicturePage, path: string, search: string): boolean {
  if (search) return false
  return page === 'desk' ? path === '/' || path === '/app' || path === '/app/desk' : path === '/app/folders'
}

/** The copy's owner on this device (`nostr/deviceCopy.ts` OWNER_KEY), read here without importing the store. */
const OWNER_KEY = 'peek-device-copy-owner'
const SIGNED_OUT = 'signed-out'

/** How long a saved page may stand in before the live page shows regardless. */
const STAND_IN_MS = 4_000

type Shown = { shownAt: number; page?: PicturePage; click?: { x: number; y: number }; liveAt?: number; clicked?: boolean }

declare global {
  interface Window {
    __peekPicture?: Shown
  }
}

function cover(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.getElementById('peek-picture')
}

function stylesheet(): string | null {
  return document.querySelector('link[rel="stylesheet"][href*="/assets/"]')?.getAttribute('href') ?? null
}

const textOf = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

/**
 * The saved page's element under a point, as a hit test would find it (the
 * saved copy is inert, so the browser's own does not): the deepest visible one
 * whose box holds it — not a control drawn invisible until hover.
 */
function savedElementAt(root: HTMLElement, x: number, y: number): Element | undefined {
  let found: Element | undefined
  let foundDepth = -1
  for (const el of root.querySelectorAll('*')) {
    const box = el.getBoundingClientRect()
    if (!(x >= box.left && x < box.right && y >= box.top && y < box.bottom)) continue
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') continue
    // Opacity is not inherited: a control faded out as a whole hides its children too.
    let depth = 0
    let faded = false
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
      depth++
      if (getComputedStyle(p).opacity === '0') faded = true
    }
    if (!faded && depth >= foundDepth) [found, foundDepth] = [el, depth]
  }
  return found
}

/** Sent when the saved page goes, so a save it held back can run. */
const GONE = 'peek-page-picture-gone'

/** What an element under a point reads, with its parent: a row's handler is often on a plain element above the text. */
const readingOf = (el: Element | null | undefined) => (el ? `${el.tagName}|${textOf(el)}|${textOf(el.parentElement)}` : '')

/**
 * The live page has drawn: the saved one goes, and a click made on it is
 * applied to the live element under the same point — only if it reads the
 * same, so a list that moved meanwhile never opens something else. The click
 * bubbles to whichever element above it handles it, as a real one would.
 */
export function revealLivePage(): void {
  const el = cover()
  const shown = typeof window === 'undefined' ? undefined : window.__peekPicture
  if (!el) return
  const click = shown?.click
  const target = click ? savedElementAt(el, click.x, click.y) : undefined
  const saved = target && textOf(target.parentElement) ? readingOf(target) : ''
  el.remove()
  if (shown) shown.liveAt = Math.round(performance.now())
  window.dispatchEvent(new Event(GONE))
  if (!click || !saved) return
  // Any element, an icon's <svg> or <path> included: the click bubbles to the control that handles it.
  const live = document.elementFromPoint(click.x, click.y)
  if (live && readingOf(live) === saved) {
    live.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: click.x, clientY: click.y, view: window }))
    if (shown) shown.clicked = true
  }
}

/**
 * Started with the app: anything other than the saved page drawing — another
 * page, the sign-in screen, an error — must not sit under it, so it goes on
 * the first route change, and after {@link STAND_IN_MS} whatever happened.
 */
export function watchPagePicture(): void {
  if (!cover()) return
  const page = window.__peekPicture?.page ?? 'desk'
  const started = performance.now()
  const check = () => {
    if (!cover()) return
    if (!isPlain(page, location.pathname, location.search)) return revealLivePage()
    if (performance.now() - started > STAND_IN_MS) return revealLivePage()
    requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
}

/** The live page has nothing left to load: no skeleton and nothing busy in it. */
function livePageDrawn(): boolean {
  const main = document.getElementById('root')?.querySelector('main')
  return !!main && !main.querySelector('.animate-pulse,[aria-busy=true]')
}

/** How long the live page must stay unchanged, with nothing loading, before it replaces a saved one that differs. */
const STILL_MS = 200

/**
 * How long a drawn live page waits for the rest when it keeps changing: on
 * production relay answers keep arriving, and waiting for stillness alone held
 * a saved Desk up for 1.4 s once (peek#492, 13 Oct).
 */
const SETTLE_MS = 100

/**
 * The page says it has its lists: it replaces the saved one as soon as it
 * reads the same, or once it has drawn and stopped changing — a Screener that
 * is still deciding can arrive a moment after Desk's lists, with no skeleton.
 */
export function revealWhenPageDrawn(): void {
  const el = cover()
  const root = document.getElementById('root')
  if (!el || !root) return
  const saved = textOf(el.querySelector('main'))
  const started = performance.now()
  let changedAt = started
  const changes = new MutationObserver(() => (changedAt = performance.now()))
  // What is drawn, not attributes: a live page restyling itself must not hold the saved one up.
  changes.observe(root, { subtree: true, childList: true, characterData: true })
  // When the live Desk first drew with nothing loading: from then on it waits at most SETTLE_MS for the rest.
  let drawnAt: number | undefined
  const check = () => {
    if (!cover()) return changes.disconnect()
    const now = performance.now()
    const drawn = livePageDrawn()
    // A list that goes back to its skeleton starts the wait again.
    drawnAt = drawn ? (drawnAt ?? now) : undefined
    const same = saved !== '' && textOf(root.querySelector('main')) === saved
    const settled = same || now - changedAt > STILL_MS || (drawnAt !== undefined && now - drawnAt > SETTLE_MS)
    if ((drawn && settled) || now - started > STAND_IN_MS) {
      changes.disconnect()
      return revealLivePage()
    }
    requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
}

/**
 * Keep what a plain page shows now, for the next tab. Only a fully drawn page
 * with nothing open is kept — what a new tab at `/app/desk` or `/app/folders`
 * draws — and only for the copy's owner. Element ids are dropped (the live
 * page has its own), and so are pictures this page made for itself, which mean
 * nothing in another.
 */
const lastKept: Partial<Record<PicturePage, string>> = {}

export function savePagePicture(page: PicturePage): void {
  try {
    if (cover() || !isPlain(page, location.pathname, location.search) || !livePageDrawn()) return
    const owner = localStorage.getItem(OWNER_KEY)
    const css = stylesheet()
    const root = document.getElementById('root')
    if (!owner || owner === SIGNED_OUT || !css || !root) return
    // On a copy of the elements, never on the markup's text: a name or title reading ` id="` would steer a pattern
    // into the next element's attributes and turn an attribute's value into markup (peek#492 review).
    const copy = root.cloneNode(true) as HTMLElement
    for (const el of copy.querySelectorAll('[id]')) el.removeAttribute('id')
    for (const img of copy.querySelectorAll('img[src^="blob:"]')) img.removeAttribute('src')
    const html = copy.innerHTML
    const value = JSON.stringify({ owner, css, html })
    // A page that settled back to what was kept costs no write.
    if (value === lastKept[page]) return
    localStorage.setItem(PICTURE_KEYS[page], value)
    lastKept[page] = value
  } catch {
    // Full or blocked storage: the next tab draws as before.
  }
}

/** How long a plain page must stay unchanged before what it shows is kept again. */
const KEEP_AFTER_MS = 1_000

/**
 * A page's part: once its lists are loaded the live page replaces the saved
 * one, and while it is plain it is kept — each time it has stopped changing
 * for a second, and as the tab is left — so the next tab gets what this one
 * showed last.
 */
export function usePagePicture(page: PicturePage, loaded: boolean, plain: boolean): void {
  useEffect(() => {
    if (loaded) revealWhenPageDrawn()
  }, [loaded])
  useEffect(() => {
    const root = document.getElementById('root')
    if (!loaded || !plain || !root) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const save = () => savePagePicture(page)
    // Off the path of anything the person does.
    const keepSoon = () => {
      clearTimeout(timer)
      timer = setTimeout(() => (typeof requestIdleCallback === 'function' ? requestIdleCallback(save, { timeout: 2_000 }) : save()), KEEP_AFTER_MS)
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') save()
    }
    const changes = new MutationObserver(keepSoon)
    changes.observe(root, { subtree: true, childList: true, characterData: true, attributes: true })
    keepSoon()
    // A save that came while the saved page was still shown was skipped: run it once the live one is.
    window.addEventListener(GONE, keepSoon)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', save)
    return () => {
      clearTimeout(timer)
      changes.disconnect()
      window.removeEventListener(GONE, keepSoon)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', save)
    }
  }, [page, loaded, plain])
}

/** Sign-out, or another person's copy: every saved page goes with it. */
export function clearPagePictures(): void {
  for (const page of Object.keys(PICTURE_KEYS) as PicturePage[]) delete lastKept[page]
  try {
    for (const key of Object.values(PICTURE_KEYS)) localStorage.removeItem(key)
  } catch {
    // Nothing kept without storage.
  }
}
