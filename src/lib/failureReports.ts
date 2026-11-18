/**
 * A write the relay refused, and a failure drawn on screen rather than toasted (a "could not be read" state, a refused
 * line under a field), are reported: the refusal by its reason code, the failure once it shows, by what failed from
 * the reporter's fixed list, never its words (PROD-5). Kept apart from
 * `errorReports`, which reads the window as it loads: this module touches nothing until the app starts reporting, so
 * a component and its test can use it freely.
 */
import { useEffect } from 'react'
import type { Failure } from '@estiva-app/platform'

let reporter: ((failure: Failure) => void) | null = null

let refusals: ((code: string) => void) | null = null

/** Where refused writes go, by the relay's reason code; set once by `startErrorReports`, `null` stops it. */
export function reportRefusalsTo(next: ((code: string) => void) | null): void {
  refusals = next
}

/**
 * Hears a write the relay refused, busy answers included, by its reason code only (`archived`, `busy`), never its
 * sentence or the event. The app's one write path calls it; a reporter that throws never changes what the write said.
 */
export function heardRefusal(code: string): void {
  try {
    refusals?.(code)
  } catch {
    /* the write's own answer stands */
  }
}

/** Where drawn failures go; set once by `startErrorReports`, `null` stops it. */
export function reportDrawnFailuresTo(next: ((failure: Failure) => void) | null): void {
  reporter = next
}

/**
 * Reports `failure` once it is drawn: `undefined` while nothing failed. Once per name per screen per tab, however
 * often it is drawn (the reporter's own rule).
 */
export function useReportFailure(failure: Failure | undefined): void {
  useEffect(() => {
    if (failure) reporter?.(failure)
  }, [failure])
}
