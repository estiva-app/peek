import { useCallback } from 'react'
import { useToast } from '@/lib/toast'

/**
 * What a delete says afterwards (Katerina, 2026-09-10: *"a delete should
 * confirm itself"*).
 *
 * Two sentences, and the difference between them is the whole point:
 *
 * - **It went** — a plain toast that fades. The thing is gone from the screen
 *   already, so this only confirms; five seconds is enough.
 * - **The relay kept it** — a `warning` toast that stays until dismissed. Peek
 *   hid it, the relay refused the tombstone, and the row is back. Left silent,
 *   a message would reappear a second after it vanished with nothing to
 *   explain it — the same silence PEEK-170 removed for topics, which the
 *   Topics page already answers this way.
 *
 * The tone and its `!` are the package's since `0.12.2`; before that the set
 * had no way to say bad news, and Peek's two standing toasts turned the icon
 * off rather than show a tick beside it.
 */
export type Deletable = 'message' | 'reply' | 'huddle' | 'topic'

export function useReportDelete(): (what: Deletable, kept: boolean) => void {
  const { showToast, dismissToast } = useToast()
  return useCallback(
    (what: Deletable, kept: boolean) => {
      const noun = what === 'reply' ? 'Reply' : what === 'huddle' ? 'Huddle' : what === 'topic' ? 'Topic' : 'Message'
      if (!kept) {
        showToast({ label: `${noun} deleted`, type: 'neutral' })
        return
      }
      showToast({
        label: `The relay kept this ${what}, so it is back. Other apps can still read it.`,
        type: 'warning',
        durationMs: 0,
        actionLabel: 'Dismiss',
        onAction: dismissToast,
      })
    },
    [showToast, dismissToast],
  )
}
