/**
 * Why Peek's requests last failed, for a failure a screen draws a moment later holding only "it failed" (34396209):
 * the bridge says what each failed read came to, and the error reporter puts the latest reason on a failure report,
 * so Sentry files "the relay said wait" apart from "the sign-in had ended". 23 Nov: nine "Could not load" reports
 * after the per-minute fixes sat in one error, and none was the limit.
 *
 * Kept apart from `errorReports`, which reads the window as it loads: `nostr/bridge.ts` and a test use this freely.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/error-reports-go-to-hosted-sentry-built-from-an-allowed-list.md
 */
import { createHeardFailures, failureReasonOf } from '@estiva-app/platform'

export const heardFailures = createHeardFailures()

/**
 * A read or a signature that failed, by what it threw or the relay's reason: its name, status and the relay's prefix.
 * `from` is `'id'` for a request Peek makes to Estiva ID itself (a decrypt), whose 429 is Estiva ID's own limit.
 * Never throws.
 */
export function heardFailure(error: unknown, from: 'relay' | 'id' = 'relay'): void {
  try {
    heardFailures.heard(failureReasonOf(error, undefined, from))
  } catch {
    /* what the request said stands */
  }
}
