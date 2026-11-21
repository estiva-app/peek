import { useEffect, useState } from 'react'
import { byFields } from '@/nostr/projectFields'

/**
 * Whether deleting the file at `address` only marks it, so it can be brought back (ALL-5): its type is kept in order
 * in this tab. False until the relay's answer is in, and for a type that is not: the delete question then says what
 * it always said.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/every-file-type-is-kept-in-order-and-a-delete-only-marks-the-file.md
 */
export function useRestorableDelete(address: string | undefined): boolean {
  const [answer, setAnswer] = useState<{ address: string; restorable: boolean } | null>(null)
  useEffect(() => {
    if (!address) return
    let cancelled = false
    void byFields(address).then(
      (restorable) => {
        if (!cancelled) setAnswer({ address, restorable })
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [address])
  return !!address && answer?.address === address && answer.restorable
}
