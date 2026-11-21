import { useEffect, useState } from 'react'
import { byFields, byFieldsNow } from '@/nostr/projectFields'

/**
 * Whether deleting the file at `address` only marks it, so it can be brought back (ALL-5): its type is kept in order
 * in this tab. Undefined while the relay's answer is not in yet, so the delete question waits for it and never
 * changes its words in front of the person; the answer is nearly always in long before Delete is pressed.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/every-file-type-is-kept-in-order-and-a-delete-only-marks-the-file.md
 */
export function useRestorableDelete(address: string | undefined): boolean | undefined {
  const [answer, setAnswer] = useState<{ address: string; restorable: boolean } | null>(null)
  const now = address ? byFieldsNow(address) : false
  useEffect(() => {
    if (!address || now !== undefined) return
    let cancelled = false
    void byFields(address).then(
      (restorable) => {
        if (!cancelled) setAnswer({ address, restorable })
      },
      // Unread is not kept in order: the question says what it always said.
      () => {
        if (!cancelled) setAnswer({ address, restorable: false })
      },
    )
    return () => {
      cancelled = true
    }
  }, [address, now])
  if (now !== undefined) return now
  return answer && answer.address === address ? answer.restorable : undefined
}
