/**
 * One block of another object, shown live in a message — SPEC §13.6.1, COM-2.
 *
 * **Pointer, never copy.** The block is read from its object every time this
 * runs and held only in this hook's state, for the life of the view: nothing
 * here writes it to a draft, a cache that outlives the card, or a preview.
 * A copy would go stale, and would keep showing the text to somebody who has
 * since lost access to the Folder it came from.
 *
 * **Live by re-reading.** A widget elsewhere in Peek reads once (see
 * `ForeignObjectWidget`); a part is the case where "as it is now" is the whole
 * point, so it reads again on an interval while the tab is visible and when
 * the tab comes back. Neither the object's Folder nor its `h` is known before
 * the first read — the pointer carries neither, by decision — so a relay
 * subscription keyed on the Folder is not available to the first render.
 */
import { useEffect, useState } from 'react'
import { resolvePart, type Block } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { validToken } from '@/auth/estivaId'
import { absenceAsViewer, blockLinkAsViewer, resolveObjectAsViewer } from '@/nostr/foreign'
import { RELAY_URL, hasRelay } from './relayUrl'

/** How often a shown part is read again while its tab is visible. */
export const PART_REFRESH_MS = 15_000

/** What a part draws. The five states of `resolvePart`, plus waiting. */
export type PartView =
  | { state: 'loading' }
  | { state: 'resolved'; block: Block; object: ForeignObject; link?: string }
  | { state: 'unaddressable' | 'detached'; object: ForeignObject; link?: string }
  | { state: 'deleted' }
  | { state: 'unreadable' }

/** Read one part once, as the signed-in viewer. Null when nobody is signed in. */
async function readPart(pointer: { address: string; block: string }): Promise<PartView | null> {
  const token = validToken()
  if (!RELAY_URL || !token) return null
  const object = await resolveObjectAsViewer(pointer.address, RELAY_URL, token)
  if (!object) {
    return (await absenceAsViewer(pointer.address, RELAY_URL, token)) === 'deleted' ? { state: 'deleted' } : { state: 'unreadable' }
  }
  const body = object.slots.body
  // An object with no body slot has no parts Peek can see — not "deleted".
  const part = body
    ? resolvePart(pointer.block, { value: body.value, format: body.format === 'blocks' ? 'blocks' : 'marker' })
    : ({ state: 'unaddressable' } as const)
  // `resolvePart` only says deleted or unreadable when told so, and it was not.
  if (part.state === 'deleted' || part.state === 'unreadable') return { state: 'unreadable' }
  const link =
    (await blockLinkAsViewer({ address: pointer.address, title: object.slots.title?.value, block: pointer.block }, RELAY_URL, token)) ??
    object.openUrl
  return part.state === 'resolved' ? { state: 'resolved', block: part.block, object, link } : { state: part.state, object, link }
}

/**
 * The part a message shows, kept current. `loading` until the first read;
 * signed out or with no relay it settles on `unreadable`, which is the truth
 * for a reader who can read nothing.
 */
export function usePart(pointer: { address: string; block: string }): PartView {
  const { address, block } = pointer
  const [view, setView] = useState<PartView>({ state: 'loading' })

  useEffect(() => {
    if (!hasRelay) return
    let cancelled = false
    const read = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      readPart({ address, block })
        .then((next) => !cancelled && setView(next ?? { state: 'unreadable' }))
        // A failed read keeps what was shown: a network blip is not a deletion.
        .catch(() => undefined)
    }
    read()
    const timer = setInterval(read, PART_REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && read()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [address, block])

  return hasRelay ? view : { state: 'unreadable' }
}
