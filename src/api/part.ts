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

/**
 * How often a shown part is read again while its tab is visible. Every card
 * reads on its own, and the relay meters `/query`, so this stays well above
 * the rate at which a description is edited during a conversation about it.
 */
export const PART_REFRESH_MS = 30_000

/** A first read that failed is tried again this soon, rather than a whole interval later. */
const FIRST_RETRY_MS = 3_000

/** The Open link per address, title and block: it changes only on a rename, so it is built once. */
const links = new Map<string, Promise<string | undefined>>()

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
  // `unreachable` is interop's stand-in for an address the read could not see
  // (it carries the noun from the manifest and nothing else): the same empty read.
  if (!object || object.unreachable) {
    return (await absenceAsViewer(pointer.address, RELAY_URL, token)) === 'deleted' ? { state: 'deleted' } : { state: 'unreadable' }
  }
  const body = object.slots.body
  // An object with no body slot has no parts Peek can see — not "deleted".
  const part = body
    ? resolvePart(pointer.block, { value: body.value, format: body.format === 'blocks' ? 'blocks' : 'marker' })
    : ({ state: 'unaddressable' } as const)
  // `resolvePart` only says deleted or unreadable when told so, and it was not.
  if (part.state === 'deleted' || part.state === 'unreadable') return { state: 'unreadable' }
  const title = object.slots.title?.value
  const key = `${pointer.address}\u0000${pointer.block}\u0000${title ?? ''}`
  if (!links.has(key)) {
    links.set(key, blockLinkAsViewer({ address: pointer.address, title, block: pointer.block }, RELAY_URL, token).catch(() => undefined))
  }
  const link = (await links.get(key)) ?? object.openUrl
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
    let shown = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      readPart({ address, block })
        .then((next) => {
          if (cancelled) return
          shown = true
          setView(next ?? { state: 'unreadable' })
        })
        // A failed read keeps what was shown: a network blip is not a deletion.
        // Nothing shown yet means a skeleton, so try again soon rather than in a full interval.
        .catch(() => {
          if (!cancelled && !shown) retry = setTimeout(read, FIRST_RETRY_MS)
        })
    }
    read()
    const timer = setInterval(read, PART_REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && read()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      if (retry) clearTimeout(retry)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [address, block])

  return hasRelay ? view : { state: 'unreadable' }
}
