import { useEffect, useRef, useState, type RefObject } from 'react'
import { READ_DWELL_MS } from '@/api'

const NONE: ReadonlySet<string> = new Set()
/** A card taller than the view can never show half of itself: this much of it is enough. */
const TALL_ENOUGH_PX = 120
/** Every tenth, so a tall card's share is reported as it scrolls, not only as it crosses half. */
const THRESHOLDS = Array.from({ length: 11 }, (_, i) => i / 10)

/**
 * The messages under `within` that have been on screen for a moment — what
 * reads a message (Katerina, 30 October): its unread look goes once it has
 * been seen, by scrolling to it or by opening its thread, not when its
 * conversation is opened.
 *
 * Each element carrying `attribute` is one message, named by the attribute's
 * value. One drawn as `display: contents` has no box of its own and is watched
 * through its first child, the card.
 *
 * On screen means half of the card shows, or `TALL_ENOUGH_PX` of a taller
 * one, inside every scrolling pane around it, for `READ_DWELL_MS` without a
 * break, in a tab that is not hidden. Scrolling past reads nothing. Where
 * there is no `IntersectionObserver` (a test's DOM), everything drawn counts as
 * on screen: the dwell alone decides, as it did before.
 *
 * What has been seen is held for `key` — the conversation, or the thread —
 * and starts again empty when it changes.
 */
export function useSeenOnScreen(within: RefObject<HTMLElement | null>, attribute: string, key: string | null): ReadonlySet<string> {
  const [seen, setSeen] = useState<{ key: string | null; ids: ReadonlySet<string> }>({ key: null, ids: NONE })
  const watch = useRef<((el: Element) => void) | null>(null)

  useEffect(() => {
    if (!key) return
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const showing = new Set<string>()
    const done = new Set<string>()
    const idOf = new WeakMap<Element, string>()
    const boxlessOf = new WeakMap<Element, boolean>()

    const arm = (id: string) => {
      if (done.has(id) || timers.has(id) || document.hidden) return
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id)
          done.add(id)
          setSeen((prev) => ({ key, ids: new Set([...(prev.key === key ? prev.ids : []), id]) }))
        }, READ_DWELL_MS),
      )
    }
    const disarm = (id: string) => {
      clearTimeout(timers.get(id))
      timers.delete(id)
    }

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                const id = idOf.get(entry.target)
                if (!id) continue
                const onScreen = entry.isIntersecting && (entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= TALL_ENOUGH_PX)
                if (onScreen) {
                  showing.add(id)
                  arm(id)
                } else {
                  showing.delete(id)
                  disarm(id)
                }
              }
            },
            { threshold: THRESHOLDS },
          )

    watch.current = (el) => {
      const id = el.getAttribute(attribute)
      if (!id) return
      // Asked once per element; the card inside is looked up on every draw, since it can be drawn anew.
      let boxless = boxlessOf.get(el)
      if (boxless === undefined) boxlessOf.set(el, (boxless = getComputedStyle(el).display === 'contents'))
      const target = boxless ? el.firstElementChild : el
      if (!target || idOf.has(target)) return
      idOf.set(target, id)
      if (observer) observer.observe(target)
      else {
        showing.add(id)
        arm(id)
      }
    }

    // A hidden tab is not being read: its clocks stop, and start again on what still shows.
    const onVisibility = () => {
      if (document.hidden) for (const id of [...timers.keys()]) disarm(id)
      else for (const id of showing) arm(id)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      watch.current = null
      observer?.disconnect()
      for (const t of timers.values()) clearTimeout(t)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [key, attribute])

  // Every draw: watch the messages drawn since the last one.
  useEffect(() => {
    const root = within.current
    const add = watch.current
    if (root && add) root.querySelectorAll(`[${attribute}]`).forEach(add)
  })

  return seen.key === key ? seen.ids : NONE
}
