/**
 * Where a type-ahead popup goes — `@`, `!@`, `[` and `/`.
 *
 * Peek's four suggestion popups are not menus: the editor's plugin owns the
 * keyboard, so the shared package's `Menu` (which brings its own Escape,
 * outside-click and placement) would fight it. They each hang a fixed
 * container off `document.body` by hand instead, and the arithmetic for that
 * was the same six lines written three times.
 *
 * **It hung them above the caret, always.** In the composer that is right and
 * always was: the composer sits at the bottom of the screen, so the room above
 * it is the whole window. The same popup opened while editing a sent message
 * is a different situation — a message can be anywhere in the stream, and one
 * near the top of the list had its menu drawn off the top of the window, which
 * looked exactly like `/` doing nothing. So: above while there is room, below
 * when there is not, and the larger side when neither fits.
 *
 * Above stays the preference rather than a "flip when closer to the edge"
 * rule, because above is where the app has always put these and a menu that
 * moved side depending on scroll position would read as a different menu.
 */

/** Between the caret and the popup, and between the popup and the window. */
const GAP = 8
const EDGE = 8

/**
 * Place `container` against the caret. Returns false when the popup has not
 * been laid out yet, so its height cannot be read.
 */
function place(container: HTMLElement, rect: DOMRect): boolean {
  const height = container.offsetHeight
  const above = () => {
    container.style.bottom = `${window.innerHeight - rect.top + GAP}px`
    container.style.top = ''
  }
  if (height === 0) {
    // React has not rendered into it yet. Above is right wherever there is
    // room, so use it and correct on the next frame rather than flashing the
    // popup in the wrong place first.
    above()
    return false
  }
  const roomAbove = rect.top - GAP - EDGE
  const roomBelow = window.innerHeight - rect.bottom - GAP - EDGE
  if (height <= roomAbove || roomAbove >= roomBelow) {
    above()
  } else {
    container.style.top = `${rect.bottom + GAP}px`
    container.style.bottom = ''
  }
  return true
}

/**
 * Hang a suggestion popup off the caret: never off the left or right edge,
 * above when it fits and below when it does not.
 *
 * `width` is the popup's own width, which the caller knows and the container
 * (a bare wrapper around it) does not.
 */
export function hangSuggestion(container: HTMLElement, rect: DOMRect, width: number) {
  const left = Math.min(rect.left, window.innerWidth - width - EDGE)
  container.style.left = `${Math.max(EDGE, left)}px`
  if (place(container, rect)) return
  requestAnimationFrame(() => {
    if (container.isConnected) place(container, rect)
  })
}
