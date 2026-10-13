/**
 * The saved copy of the Desk page: the markup Peek last drew for a plain Desk,
 * kept on the device and shown by `index.html`'s inline script the moment a
 * new tab's page arrives, before the app has loaded. The live Desk replaces it
 * in place once it has drawn, and a click made on it in between is applied
 * then (Miky, 13 Oct: "A new Peek tab draws Desk within 200 ms").
 *
 * It is markup, not an image, drawn with the stylesheet the page loads, so it
 * is shown only when that stylesheet is the one it was saved with. It belongs
 * to the person whose copy on the device it sits beside: it is saved under the
 * copy's owner, shown only to them, and removed whenever the copy is
 * (`nostr/deviceCopy.ts`). The inline script reads the same keys: keep the two
 * in step.
 */
import { useEffect } from 'react'

/** Where the saved Desk is kept, in `localStorage`. */
export const DESK_PICTURE_KEY = 'peek-desk-picture'

/** The copy's owner on this device (`nostr/deviceCopy.ts` OWNER_KEY), read here without importing the store. */
const OWNER_KEY = 'peek-device-copy-owner'
const SIGNED_OUT = 'signed-out'

/** How long the saved Desk may stand in before the live page shows regardless. */
const STAND_IN_MS = 4_000

type Shown = { shownAt: number; click?: { x: number; y: number }; liveAt?: number; clicked?: boolean }

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
 * The saved Desk's element under a point, as a hit test would find it (the
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

/** Sent when the saved Desk goes, so a save it held back can run. */
const GONE = 'peek-desk-picture-gone'

/** What an element under a point reads, with its parent: a row's handler is often on a plain element above the text. */
const readingOf = (el: Element | null | undefined) => (el ? `${el.tagName}|${textOf(el)}|${textOf(el.parentElement)}` : '')

/**
 * The live Desk has drawn: the saved one goes, and a click made on it is
 * applied to the live element under the same point — only if it reads the
 * same, so a list that moved meanwhile never opens something else. The click
 * bubbles to whichever element above it handles it, as a real one would.
 */
export function revealLiveDesk(): void {
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
 * Started with the app: anything other than Desk drawing — another page, the
 * sign-in screen, an error — must not sit under the saved Desk, so it goes on
 * the first route change, and after {@link STAND_IN_MS} whatever happened.
 */
export function watchDeskPicture(): void {
  if (!cover()) return
  const started = performance.now()
  const check = () => {
    if (!cover()) return
    if (location.pathname !== '/app/desk' && location.pathname !== '/' && location.pathname !== '/app') return revealLiveDesk()
    if (performance.now() - started > STAND_IN_MS) return revealLiveDesk()
    requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
}

/** The live page has nothing left to load: no skeleton and nothing busy in it. */
function liveDeskDrawn(): boolean {
  const main = document.getElementById('root')?.querySelector('main')
  return !!main && !main.querySelector('.animate-pulse,[aria-busy=true]')
}

/** How long the live Desk must stay unchanged, with nothing loading, before it replaces a saved Desk that differs. */
const STILL_MS = 200

/**
 * How long a drawn live Desk waits for the rest when it keeps changing: on
 * production relay answers keep arriving, and waiting for stillness alone held
 * a saved Desk up for 1.4 s once (peek#492, 13 Oct).
 */
const SETTLE_MS = 100

/**
 * Desk says it has its lists: it replaces the saved one as soon as it reads
 * the same, or once it has drawn and stopped changing — a Screener that is
 * still deciding can arrive a moment after the lists, with no skeleton.
 */
export function revealWhenDeskDrawn(): void {
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
    const drawn = liveDeskDrawn()
    // A list that goes back to its skeleton starts the wait again.
    drawnAt = drawn ? (drawnAt ?? now) : undefined
    const same = saved !== '' && textOf(root.querySelector('main')) === saved
    const settled = same || now - changedAt > STILL_MS || (drawnAt !== undefined && now - drawnAt > SETTLE_MS)
    if ((drawn && settled) || now - started > STAND_IN_MS) {
      changes.disconnect()
      return revealLiveDesk()
    }
    requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
}

/**
 * Keep what a plain Desk shows now, for the next tab. Only a fully drawn Desk
 * with nothing open is kept — what a new tab at `/app/desk` draws — and only
 * for the copy's owner. Element ids are dropped (the live page has its own),
 * and so are pictures this page made for itself, which mean nothing in another.
 */
let lastKept: string | undefined

export function saveDeskPicture(): void {
  try {
    if (cover() || location.pathname !== '/app/desk' || location.search || !liveDeskDrawn()) return
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
    // A Desk that settled back to what was kept costs no write.
    if (value === lastKept) return
    localStorage.setItem(DESK_PICTURE_KEY, value)
    lastKept = value
  } catch {
    // Full or blocked storage: the next tab draws as before.
  }
}

/** How long a plain Desk must stay unchanged before what it shows is kept again. */
const KEEP_AFTER_MS = 1_000

/**
 * Desk's part: once its lists are loaded the live page replaces the saved one,
 * and while it is a plain Desk it is kept — each time it has stopped changing
 * for a second, and as the tab is left — so the next tab gets what this one
 * showed last.
 */
export function useDeskPicture(loaded: boolean, plain: boolean): void {
  useEffect(() => {
    if (loaded) revealWhenDeskDrawn()
  }, [loaded])
  useEffect(() => {
    const root = document.getElementById('root')
    if (!loaded || !plain || !root) return
    let timer: ReturnType<typeof setTimeout> | undefined
    // Off the path of anything the person does.
    const keepSoon = () => {
      clearTimeout(timer)
      timer = setTimeout(() => (typeof requestIdleCallback === 'function' ? requestIdleCallback(saveDeskPicture, { timeout: 2_000 }) : saveDeskPicture()), KEEP_AFTER_MS)
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') saveDeskPicture()
    }
    const changes = new MutationObserver(keepSoon)
    changes.observe(root, { subtree: true, childList: true, characterData: true, attributes: true })
    keepSoon()
    // A save that came while the saved Desk was still shown was skipped: run it once the live one is.
    window.addEventListener(GONE, keepSoon)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', saveDeskPicture)
    return () => {
      clearTimeout(timer)
      changes.disconnect()
      window.removeEventListener(GONE, keepSoon)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', saveDeskPicture)
    }
  }, [loaded, plain])
}

/** Sign-out, or another person's copy: the saved Desk goes with it. */
export function clearDeskPicture(): void {
  lastKept = undefined
  try {
    localStorage.removeItem(DESK_PICTURE_KEY)
  } catch {
    // Nothing kept without storage.
  }
}
