import { useEffect, useState } from 'react'
import { eventIdFromRef } from '@estiva-app/interop'
import { Navigate, useParams } from 'react-router-dom'
import { useForeignObjects } from '@/api'
import type { ReferencePlace } from '@/nostr/foreign'
import { useLastSelection } from '@/lib/lastSelection'
import { filePath } from '@/lib/objectUrl'
import { channelDestination } from '@/lib/legacyTopicLinks'
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
 * place and hands off to the page that owns it — the file's own page (FOL-19),
 * which `FilePage` owns, and for a channel or a message said in one, the file a
 * retired topic moved to or else the channel's Folder (FOL-26). It deliberately renders
 * nothing of its own beyond the two states a person needs to tell apart.
 *
 * **A reference Peek cannot open says so.** Another app's `naddr` is a valid
 * reference, and redirecting it somewhere arbitrary would be worse than an
 * honest empty state — the same argument the widget layer makes about a blank
 * card reading as "that app is broken".
 */
export function ObjectPage() {
  const { ref } = useParams<{ ref: string }>()
  const { placeForReference } = useForeignObjects()
  const { setPendingTopicMessage } = useLastSelection()
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
        /*
          A message link lands on the message, not merely in its topic (RIC-16).
          The topic view opens the conversation once it has loaded — the same
          one-shot the launcher's search results use, keyed by what this page
          knows (the Folder and the event) rather than by Peek's own ids.

          A comment on a file is the same one-shot read by the file's page
          (FOL-36): the thread is the conversation, and a reply in it is the
          message to land on once the thread is open — the launcher's own
          shape for a reply (R13).
        */
        if (place?.message) {
          setPendingTopicMessage(
            place.thread && place.thread !== place.message
              ? { folder: place.folder, eventId: place.thread, reply: place.message }
              : { folder: place.folder, eventId: place.thread ?? place.message },
          )
        }
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
  }, [ref, placeForReference, setPendingTopicMessage])

  if (state === 'looking') return <ObjectPageView state="looking" />
  if (state === 'unopenable') return <ObjectPageView state="unopenable" />
  /*
    A file opens at its own address — `/topic/<address>`, FOL-19.

    This used to be `/folders/<folder>?file=<address>`, which needed the file to
    be *in that Folder's listing* and so opened nothing for a Ship issue: an
    issue is its project's child, fetched from the project's manifest, never a
    peer in the listing. The file route resolves the address on its own, so
    every reference lands on the file rather than near it.
  */
  if (state.file) {
    /*
      A comment opens its file with the thread already open (FOL-36): the
      thread is in the URL on the file page — a link, `?thread=` — so the link
      to a comment is a link to its thread, and the one-shot above only has
      to scroll. Before this, a comment's link landed by `h` on the team's
      channel, which is not where the comment is.
    */
    const thread = state.thread ? `?thread=${encodeURIComponent(state.thread)}` : ''
    return <Navigate to={`${filePath(state.file)}${thread}`} replace />
  }
  /*
    Something said in a DM opens the DM, with the one-shot above opening its
    thread (PEE-36). Its channel is not a Folder, and landing by `h` drew an
    empty "DM" page that offered to delete the conversation.
  */
  if (state.dm) return <Navigate to={`/app/people/${state.dm}`} replace />
  // A channel, or something said in one: a retired topic's lands on the file its
  // conversation moved to, and a team's on its Folder (FOL-26).
  return <Navigate to={channelDestination(state.folder)} replace />
}

/**
 * The only two things this route ever draws — the half a story can show
 * (UIG-17).
 *
 * `ObjectPage` above resolves a reference and hands off; it has no layout of
 * its own beyond these two sentences, which is why this view is two lines
 * rather than a page. They are here because **they are states nobody could
 * see**: reaching the second one meant finding a reference Peek genuinely
 * cannot open, and the first is gone in a blink.
 *
 * The frame is a flex column the height of the window, so a page-scope empty
 * state fills it as a flex child and centres (D46). It used to sit near the top
 * under a padding of its own.
 */
export function ObjectPageView({ state }: { state: 'looking' | 'unopenable' }) {
  return (
    <div className="flex min-h-screen flex-col">
      <EmptyState
        message={
          state === 'looking'
            ? 'Opening…'
            : // A reference Peek cannot open says so. Another app's `naddr` is a
              // valid reference, and redirecting it somewhere arbitrary would be
              // worse than an honest empty state — the same argument the widget
              // layer makes about a blank card reading as "that app is broken".
              'That link does not point at anything Peek can open.'
        }
      />
    </div>
  )
}
