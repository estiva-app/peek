/**
 * Peek's page-open timings: how long a person waited for a page to open goes
 * to Estiva ID, signed in, and on to Sentry, beside the crash reports. Built
 * from a fixed list by `@estiva-app/platform`'s timer: the kind of screen (the
 * same route patterns crash reports use), how it was opened, the wait. Never
 * the address, a title or which conversation it was.
 *
 * The wait runs until the live page is there: no loading placeholder left,
 * under the saved picture too. When `index.html` drew the saved picture first,
 * the moment it showed is a second number, never the wait (Miky, 19 Nov: "The
 * saved picture is nice placeholder but misleading if it takes for long"). A
 * new tab that passes through Estiva ID to sign in is timed from its first
 * page, as the speed kit counts it.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/page-open-timings-go-to-sentry-named-by-the-person-built-from-an-allowed-list.md
 */
import { browserPage, createPageTimer } from '@estiva-app/platform'
import { ESTIVA_ID_ORIGIN, currentEstivaToken, onLeavingForSignIn } from '@/auth/estivaId'
import { SCREENS, screenOf } from './errorReports'

export const pageTimer = createPageTimer({
  endpoint: `${ESTIVA_ID_ORIGIN}/timing`,
  // The commit this bundle was built from (vite.config.ts), as crash reports say it.
  release: String(import.meta.env.VITE_PEEK_RELEASE ?? 'unknown'),
  token: currentEstivaToken,
  screen: () => screenOf(window.location.pathname),
  screens: SCREENS,
  page: browserPage(window),
  // Set by index.html's inline script when it drew the saved Desk or Topics (pagePicture.ts).
  picture: () => window.__peekPicture?.shownAt,
})

/**
 * Calls back each time a person opens another page inside Peek: a link, a
 * `navigate()`, Back or Forward to another path. React Router writes the
 * address through `history.pushState` before it draws the new page, so the
 * open starts there, as Ship's own router starts it. A redirect in place
 * (`replaceState`) or a change of query alone is not an open.
 */
function onOpen(listener: () => void): () => void {
  let openPath = window.location.pathname
  const push = window.history.pushState
  window.history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
    const before = window.location.pathname
    push.apply(this, args)
    if (window.location.pathname !== before) listener()
    openPath = window.location.pathname
  }
  const popped = () => {
    if (window.location.pathname !== openPath) listener()
    openPath = window.location.pathname
  }
  window.addEventListener('popstate', popped)
  return () => {
    window.history.pushState = push
    window.removeEventListener('popstate', popped)
  }
}

/** Times this page load, then every page opened in place. Returns the way to stop. */
export function startPageTimings(): () => void {
  pageTimer.loaded()
  const offOpen = onOpen(() => pageTimer.opened())
  const offLeaving = onLeavingForSignIn(() => pageTimer.leaving())
  return () => {
    offOpen()
    offLeaving()
    pageTimer.stop()
  }
}
