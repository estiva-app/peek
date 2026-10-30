/**
 * One block of another object, shown live in a message — SPEC §13.6.1, COM-2.
 *
 * **Pointer, never copy.** The block is read from its object every time this
 * runs and held only in this hook's state, for the life of the view: nothing
 * here writes it to a draft, a cache that outlives the card, or a preview.
 * A copy would go stale, and would keep showing the text to somebody who has
 * since lost access to the Folder it came from.
 *
 * **Live by re-reading.** A card elsewhere in Peek reads once and is held (see
 * `useHeldCard`); a part is the case where "as it is now" is the whole
 * point, so it reads again on an interval while the tab is visible and when
 * the tab comes back. Neither the object's Folder nor its `h` is known before
 * the first read — the pointer carries neither, by decision — so a relay
 * subscription keyed on the Folder is not available to the first render.
 */
import { useEffect, useState } from 'react'
import { KIND, resolveCommentAnchor, resolvePart, type Block, type Quote } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { heldToken } from '@/auth/heldSession'
import { readAbsence } from '@estiva-app/protocol'
import { blockLinkAsViewer, resolveObjectAsViewer, viewerQuery } from '@/nostr/foreign'
import { relayBudget } from '@/nostr/relayBudget'
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

/**
 * What a part draws. The five states of `resolvePart`, plus waiting — and, for
 * a comment's anchor, `reworded`: its blocks are there and the words it quoted
 * are not (§13.6, LEAF-7). `run` is every block of an anchor's run when it has
 * more than one; `block` is always the first.
 */
export type PartView =
  | { state: 'loading' }
  | { state: 'resolved'; block: Block; run?: Block[]; object: ForeignObject; link?: string }
  | { state: 'reworded'; block: Block; run?: Block[]; quote: Quote; object: ForeignObject; link?: string }
  | { state: 'unaddressable' | 'detached'; object: ForeignObject; link?: string }
  | { state: 'deleted' }
  | { state: 'unreadable' }

/**
 * What a card points at: one block (`part`), or a comment's anchor, read from
 * its `block` and `quote` tags as written (`anchorTags`).
 */
export interface PartPointerView {
  address: string
  block: string
  anchorTags?: string[][]
}

/** Only an `https:` link is followed off the page; anything else is no link. */
function httpsLink(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

/**
 * Where Open in goes: the block's link, only when it is `https:` and on the
 * object's own host, and otherwise the object's link (PEE-51). The block link
 * is built from any member's `kind:31990` `urls` shape — the relay takes a
 * manifest from any key with UsersWrite — so a planted shape must not be able
 * to send the button to a script or to somebody else's site.
 */
export function openLinkOf(blockLink: string | undefined, openUrl: string | undefined): string | undefined {
  const object = httpsLink(openUrl)
  const block = httpsLink(blockLink)
  if (!block || !object) return object
  return new URL(block).origin === new URL(object).origin ? block : object
}

/** Read one part once, as the signed-in viewer. Null when nobody is signed in. */
async function readPart(pointer: PartPointerView): Promise<PartView | null> {
  const token = heldToken()
  if (!RELAY_URL || !token) return null
  const object = await resolveObjectAsViewer(pointer.address, RELAY_URL, token)
  // `unreachable` is interop's stand-in for an address the read could not see
  // (it carries the noun from the manifest and nothing else): the same empty read.
  if (!object || object.unreachable) {
    // Deleted only by a deletion the protocol trusts (SPEC §13.6.1); a read that fails says neither.
    const absence = await readAbsence(pointer.address, viewerQuery(RELAY_URL, token)).catch(() => 'unreadable' as const)
    return absence === 'deleted' ? { state: 'deleted' } : { state: 'unreadable' }
  }
  const body = object.slots.body
  const format = body?.format === 'blocks' ? 'blocks' : 'marker'
  const title = object.slots.title?.value
  const key = `${pointer.address}\u0000${pointer.block}\u0000${title ?? ''}`
  if (!links.has(key)) {
    links.set(key, blockLinkAsViewer({ address: pointer.address, title, block: pointer.block }, RELAY_URL, token).catch(() => undefined))
  }
  const link = openLinkOf(await links.get(key), object.openUrl)
  // An object with no body slot has no parts Peek can see — not "deleted".
  if (!body) return { state: 'unaddressable', object, link }

  if (pointer.anchorTags) {
    // A comment's anchor: its run of blocks and the words at its ends, read
    // against the file as it is now. A comment about words that changed is
    // `reworded`, never `detached` — its blocks are still there.
    const anchor = resolveCommentAnchor({ kind: KIND.COMMENT, tags: pointer.anchorTags }, body.value, format)
    if (anchor.state === 'resolved' || anchor.state === 'reworded') {
      const run = anchor.blocks.length > 1 ? { run: anchor.blocks } : {}
      return anchor.state === 'resolved'
        ? { state: 'resolved', block: anchor.blocks[0], ...run, object, link }
        : { state: 'reworded', block: anchor.blocks[0], ...run, quote: anchor.quote, object, link }
    }
    // `unanchored` cannot come back from tags that hold a `block`; read it as unaddressable rather than draw nothing.
    return { state: anchor.state === 'detached' ? 'detached' : 'unaddressable', object, link }
  }

  const part = resolvePart(pointer.block, { value: body.value, format })
  // `resolvePart` only says deleted or unreadable when told so, and it was not.
  if (part.state === 'deleted' || part.state === 'unreadable') return { state: 'unreadable' }
  return part.state === 'resolved' ? { state: 'resolved', block: part.block, object, link } : { state: part.state, object, link }
}

/**
 * The part a message shows, kept current. `loading` until the first read;
 * signed out or with no relay it settles on `unreadable`, which is the truth
 * for a reader who can read nothing.
 */
export function usePart(pointer: PartPointerView): PartView {
  const { address, block, anchorTags } = pointer
  // The tags arrive as a new array on every render; their text is what identifies the poll.
  const anchor = anchorTags ? JSON.stringify(anchorTags) : ''
  const [view, setView] = useState<PartView>({ state: 'loading' })

  useEffect(() => {
    if (!hasRelay) return
    const tags = anchor ? (JSON.parse(anchor) as string[][]) : undefined
    return watchPart(`${address}\u0000${block}\u0000${anchor}`, { address, block, anchorTags: tags }, setView)
  }, [address, block, anchor])

  return hasRelay ? view : { state: 'unreadable' }
}

/**
 * One poll per `address#block`, however many cards show it — an issue with a
 * dozen anchored comments is read once per tick, not a dozen times — and none
 * while the relay has asked every client to pause (`relayBudget`, PER-13).
 */
interface Poll {
  listeners: Set<(view: PartView) => void>
  last?: PartView
  stop: () => void
}
const polls = new Map<string, Poll>()

function watchPart(key: string, pointer: PartPointerView, listener: (view: PartView) => void): () => void {
  let poll = polls.get(key)
  if (!poll) {
    const created: Poll = { listeners: new Set(), stop: () => undefined }
    let retry: ReturnType<typeof setTimeout> | undefined
    const read = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (relayBudget.pausedForMs() > 0) return
      readPart(pointer)
        .then((next) => {
          created.last = next ?? { state: 'unreadable' }
          for (const notify of created.listeners) notify(created.last)
        })
        // A failed read keeps what was shown: a network blip is not a deletion.
        // Nothing shown yet means a skeleton, so try again soon rather than in a full interval.
        .catch(() => {
          if (!created.last && polls.get(key) === created) retry = setTimeout(read, FIRST_RETRY_MS)
        })
    }
    const timer = setInterval(read, PART_REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && read()
    document.addEventListener('visibilitychange', onVisible)
    created.stop = () => {
      clearInterval(timer)
      if (retry) clearTimeout(retry)
      document.removeEventListener('visibilitychange', onVisible)
    }
    polls.set(key, created)
    poll = created
    read()
  }
  const current = poll
  current.listeners.add(listener)
  if (current.last) listener(current.last)
  return () => {
    current.listeners.delete(listener)
    if (current.listeners.size === 0) {
      current.stop()
      polls.delete(key)
    }
  }
}
