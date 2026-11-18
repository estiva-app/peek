/**
 * Peek's crash reports (PROD-2): when a part of Peek breaks, a short report
 * goes to Estiva ID, signed in, and on to Sentry. It says where the code broke
 * and the screens before it, never what anyone wrote: the report is built from
 * a fixed list by `@estiva-app/platform`'s reporter, and Estiva ID rebuilds it
 * from the same list.
 *
 * Reported: an error nobody handled and a promise nobody caught (the window's
 * own events), and every crash an `ErrorBoundary` catches.
 */
import { useEffect, useLayoutEffect, useState } from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { createErrorReporter } from '@estiva-app/platform'
import { reportCrashesTo } from '@estiva-app/ui'
import { ESTIVA_ID_ORIGIN, currentEstivaToken } from '@/auth/estivaId'

/**
 * Peek's routes as patterns, most specific first: `/:word/:ref` would match
 * `/app/dms` too. Estiva ID keeps the same list and sends anything else as
 * `<unknown>`; a new route is added in both.
 */
const SCREENS = [
  '/',
  '/app',
  '/app/desk',
  '/app/dms',
  '/app/dms/:id',
  '/app/folders',
  '/app/folders/:id',
  '/app/folders/:id/chat',
  '/app/initiatives',
  '/app/initiatives/explore',
  '/app/people',
  '/app/people/:id',
  '/app/teams',
  '/app/teams/:id',
  '/app/teams/:id/chat',
  '/app/topics',
  '/app/topics/explore',
  '/auth/callback',
  '/desk',
  '/folders',
  '/folders/:id',
  '/folders/:id/chat',
  '/message/:ref',
  '/o/:ref',
  '/people',
  '/people/:id',
  '/topic-old/:ref',
  '/topics',
  '/topics/:id',
  '/:word/:ref',
]

/** The route pattern an address is drawn by (`/app/teams/:id`), never the address itself. */
export function screenOf(pathname: string): string {
  return SCREENS.find((pattern) => matchPath({ path: pattern, end: true }, pathname)) ?? '<unknown>'
}

export const errorReporter = createErrorReporter({
  endpoint: `${ESTIVA_ID_ORIGIN}/report`,
  // The commit this bundle was built from (vite.config.ts), so Sentry tells versions apart.
  release: String(import.meta.env.VITE_PEEK_RELEASE ?? 'unknown'),
  origin: window.location.origin,
  token: currentEstivaToken,
  screen: () => screenOf(window.location.pathname),
  screens: SCREENS,
})

/** Starts reporting: the window's unhandled errors, and every ErrorBoundary's crash. */
export function startErrorReports(): void {
  errorReporter.listen(window)
  reportCrashesTo((error) => errorReporter.report(error, 'boundary'))
  window.__crashOnPurpose = crashOnPurpose
}

declare global {
  interface Window {
    /** A crash in Peek's own code, to check a report end to end on production. See {@link crashOnPurpose}. */
    __crashOnPurpose?: typeof crashOnPurpose
  }
}

let crashWith: ((text: string) => void) | undefined

/**
 * `window.__crashOnPurpose(text, how)`: Peek reads `text` as JSON, the way it
 * reads a decrypted message, and fails, so a report can be checked end to end
 * as QA-1 (PROD-2). `'render'` (the default) fails inside a part of the page,
 * caught by its ErrorBoundary; `'unhandled'` fails in a timer, which nothing
 * catches, and can be repeated.
 */
function crashOnPurpose(text: string, how: 'render' | 'unhandled' = 'render'): void {
  if (how === 'unhandled') setTimeout(() => JSON.parse(text))
  else crashWith?.(text)
}

/** The part of the page `crashOnPurpose` fails inside; nothing on screen until then. */
export function CrashOnPurpose(): null {
  const [text, setText] = useState<string>()
  useEffect(() => {
    crashWith = setText
    return () => {
      crashWith = undefined
    }
  }, [])
  if (text !== undefined) JSON.parse(text)
  return null
}

/**
 * Records each screen opened, for the steps a report shows before its error.
 * A layout effect, and drawn before the rest of the page: a boundary hands its
 * crash over in the same commit, after this, so a screen that crashes as it
 * opens is still in the trail.
 */
export function ScreenSteps(): null {
  const { pathname } = useLocation()
  useLayoutEffect(() => {
    errorReporter.step({ screen: screenOf(pathname) })
  }, [pathname])
  return null
}
