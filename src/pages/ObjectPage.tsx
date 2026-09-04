import { useEffect, useState } from 'react'
import { eventIdFromRef } from '@estiva-app/interop'
import { Navigate, useParams } from 'react-router-dom'
import { useForeignObjects } from '@/api'
import { EmptyState } from '@/components/ui/EmptyState'

/**
 * `/o/<bech32>` — the address Peek's NIP-89 manifest advertises (PRO-11).
 *
 * A consumer that resolves one of Peek's objects is told it can be opened here.
 * That claim was published before any route served it, so "open in Peek" landed
 * a person on their desk with no indication anything had gone wrong — the
 * failure mode §13.6 describes: *renders fine, quietly does less.*
 *
 * This route exists to make the claim true. It resolves the reference to a
 * Folder and hands off to the canonical topic URL, which `TopicsPage` already
 * owns; it deliberately renders nothing of its own beyond the two states a
 * person needs to tell apart.
 *
 * **A reference Peek cannot open says so.** Another app's `naddr` is a valid
 * reference, and redirecting it somewhere arbitrary would be worse than an
 * honest empty state — the same argument the widget layer makes about a blank
 * card reading as "that app is broken".
 */
export function ObjectPage() {
  const { ref } = useParams<{ ref: string }>()
  const { folderForReference } = useForeignObjects()
  const [state, setState] = useState<{ folder: string } | 'looking' | 'unopenable'>('looking')

  useEffect(() => {
    if (!ref) {
      setState('unopenable')
      return
    }
    let cancelled = false
    /*
      A `/message/<slug>-<id>` path carries a slug in front of the identity, the
      same way `/topic/<slug>-<d>` does. `eventIdFromRef` reads the tail; a ref
      that is already a bare reference — an naddr, an nevent, an address — is
      passed through untouched.
    */
    const decoded = decodeURIComponent(ref)
    folderForReference(eventIdFromRef(decoded) ?? decoded)
      .then((folder) => {
        if (cancelled) return
        setState(folder ? { folder } : 'unopenable')
      })
      .catch(() => {
        // A read that failed and a reference that names nothing are the same
        // sentence to the person standing here: Peek cannot open it.
        if (!cancelled) setState('unopenable')
      })
    return () => {
      cancelled = true
    }
  }, [ref, folderForReference])

  if (state === 'looking') return <EmptyState className="py-16" message="Opening…" />
  if (state === 'unopenable') {
    return (
      <EmptyState
        className="py-16"
        message="That link does not point at anything Peek can open."
      />
    )
  }
  // `/topic/<uuid>` without a slug: TopicsPage canonicalises the URL once the
  // topic resolves and it knows the title, exactly as it does for a legacy link.
  return <Navigate to={`/topic/${state.folder}`} replace />
}
