import type { MouseEvent } from 'react'

/**
 * A click on a real link that the app follows itself, in place (UIG-14, 4.13).
 *
 * The link keeps its address, so a modified click, a middle click or "open in
 * new tab" is the browser's and opens it there. A plain left click (Enter on a
 * focused link is one too) is the app's: the default is prevented and `go`
 * routes in place, because a bare anchor would reload the app. The same rule
 * `RouterLink` and `NavItem` follow.
 */
export function followInApp(event: MouseEvent<HTMLElement>, go: () => void) {
  if (event.defaultPrevented) return
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  go()
}
