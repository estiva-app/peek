import { useEffect, type RefObject } from 'react'
import { isNearBottom } from './scrollPolicy'

/**
 * The message at the top of a conversation's view, and how far below the
 * view's top it is: what "the same spot" means to the reader, whatever above
 * it changed height.
 */
export function anchorIn(el: HTMLElement): { id: string; top: number } | undefined {
  // jsdom has no layout: no anchor, and the restore keeps the plain offset.
  if (typeof document.elementFromPoint !== 'function') return undefined
  const box = el.getBoundingClientRect()
  // A gap between cards, or a date line, is passed over a few pixels at a time.
  for (let y = box.top + 1; y < box.top + 96; y += 8) {
    const marker = document.elementFromPoint(box.left + box.width / 2, y)?.closest<HTMLElement>('[data-root]')
    const card = marker?.firstElementChild
    if (marker?.dataset.root && card) return { id: marker.dataset.root, top: card.getBoundingClientRect().top - box.top }
  }
  return undefined
}

/**
 * Keeps a conversation where the reader is while what is in it changes size —
 * a card, a chip or an image filling in, a card shown or hidden (OPT-10).
 *
 * At the bottom (`atBottom`, the view's own policy), it stays the same distance
 * from the bottom, so the newest messages stay in view as a card above them
 * loads. Anywhere else, the message at the top of the view stays at the same
 * height. Browsers that anchor scrolling themselves (Chromium, Firefox) do
 * the second only for what changes above the view, and only roughly; Safari
 * does neither, and a conversation there was pushed thousands of pixels off
 * its bottom by one card.
 *
 * Only once `ready()` says the conversation has been placed — before that,
 * where it lands is the view's to decide. Without `atBottom`, a view with no
 * policy of its own (a thread), "at the bottom" is where the last scroll left it.
 */
export function useSteadyScroll(
  scrollRef: RefObject<HTMLElement | null>,
  atBottom: RefObject<boolean> | undefined,
  ready: () => boolean,
  key: unknown,
): void {
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let fromBottom = 0
    let lastTop = 0
    let anchor: ReturnType<typeof anchorIn>
    let scrolledToBottom = true
    const bottom = () => (atBottom ? atBottom.current : scrolledToBottom)
    const remember = () => {
      fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      lastTop = el.scrollTop
      anchor = bottom() ? undefined : anchorIn(el)
    }
    remember()
    const onScroll = () => {
      scrolledToBottom = isNearBottom(el)
      remember()
    }
    const keep = () => {
      if (!ready()) return remember()
      if (bottom()) {
        /*
          The distance it was left at — unless the view was moved down to the
          live edge since (a new message followed, before its scroll event):
          that move stands, rather than being put back.
        */
        const now = el.scrollHeight - el.scrollTop - el.clientHeight
        const keepAt = el.scrollTop > lastTop && now < fromBottom ? now : fromBottom
        const top = el.scrollHeight - el.clientHeight - Math.max(0, keepAt)
        if (Math.abs(el.scrollTop - top) >= 1) el.scrollTop = top
      } else if (anchor) {
        const card = el.querySelector(`[data-root="${CSS.escape(anchor.id)}"]`)?.firstElementChild
        if (card) {
          const moved = card.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.top
          if (Math.abs(moved) >= 1) el.scrollTop += moved
        }
      }
      remember()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    // The scroller for its own height (the composer grows), its content for everything in it.
    const observer = new ResizeObserver(keep)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [scrollRef, atBottom, ready, key])
}
