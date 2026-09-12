import { useEffect, useState } from 'react'
import { eventIdFromRef } from '@estiva-app/interop'
import { Navigate, useParams } from 'react-router-dom'
import { useForeignObjects } from '@/api'
import type { ReferencePlace } from '@/nostr/foreign'
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
 * place and hands off to the page that owns it — the canonical topic URL for
 * a Topic or a Message, which `TopicsPage` already owns; the Folder with the
 * file open for a bare file (FOL-17), which `FoldersPage` owns. It
 * deliberately renders nothing of its own beyond the two states a person needs
 * to tell apart.
 *
 * **A reference Peek cannot open says so.** Another app's `naddr` is a valid
 * reference, and redirecting it somewhere arbitrary would be worse than an
 * honest empty state — the same argument the widget layer makes about a blank
 * card reading as "that app is broken".
 */
export function ObjectPage() {
  const { ref } = useParams<{ ref: string }>()
  const { placeForReference } = useForeignObjects()
  const [state, setState] = useState<ReferencePlace | 'looking' | 'unopenable'>('looking')

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
    placeForReference(eventIdFromRef(decoded) ?? decoded)
      .then((place) => {
        if (cancelled) return
        setState(place ?? 'unopenable')
      })
      .catch(() => {
        // A read that failed and a reference that names nothing are the same
        // sentence to the person standing here: Peek cannot open it.
        if (!cancelled) setState('unopenable')
      })
    return () => {
      cancelled = true
    }
  }, [ref, placeForReference])

  // The page's own frame: a flex column the height of the window, so the
  // page-scope empty state fills it as a flex child and centres (D46) — it
  // used to sit near the top under a padding of its own.
  if (state === 'looking') return <div className="flex min-h-screen flex-col"><EmptyState message="Opening…" /></div>
  if (state === 'unopenable') {
    return (
      <div className="flex min-h-screen flex-col">
        <EmptyState message="That link does not point at anything Peek can open." />
      </div>
    )
  }
  // A file is not a container and has no page of its own: it opens beside the
  // Folder it lives in, which `FoldersPage` reads off `?file=`.
  if (state.file) {
    return <Navigate to={`/folders/${state.folder}?file=${encodeURIComponent(state.file)}`} replace />
  }
  // `/topic/<uuid>` without a slug: TopicsPage canonicalises the URL once the
  // topic resolves and it knows the title, exactly as it does for a legacy link.
  return <Navigate to={`/topic/${state.folder}`} replace />
}
