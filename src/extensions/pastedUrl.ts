import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import { encodeNaddr, encodeNevent, addressToPointer } from '@estiva-app/protocol'
import { referenceFromPastedUrl, type UrlReference } from '@/api'

/**
 * A pasted app link becomes its chip while you write — "The composer resolves
 * a URL as you paste it" (Widgets).
 *
 * Miky, 4 Sep: "if you're pasting the URL in the composer, it should resolve
 * inside the composer so you can immediately see how it looks." Until this, a
 * pasted `https://` link stayed a link in the editor and turned into its chip
 * only once sent.
 *
 * **Only a clipboard that is one URL** (Miky, 13 Oct, kickoff): pasted alone
 * or at a caret mid-sentence. A copied passage keeps its links as written, and
 * a URL pasted over selected words stays a link on those words — that is the
 * Link extension's paste (PEE-19), which this leaves alone.
 *
 * **The link lands first, and the chip replaces it when the lookup answers.**
 * `referenceFromUrlAsViewer` costs a `#d` query, so the paste cannot wait for
 * it. The range is followed through every edit; if the text there is no longer
 * the URL when the answer comes (typed over, deleted, sent), nothing is
 * replaced. A URL no manifest claims, a failed read, or no session leaves the
 * link as it is. The swap is its own step, so Ctrl+Z gives the URL back.
 *
 * **A link to one block stays a link** (`#block-…`, COM-2): the sent message
 * draws that block live from its `part` tag, which an address chip would drop.
 *
 * **What is sent is the marker** (Miky, 13 Oct, kickoff): the `objectMention`
 * writes `nostr:naddr…` / `nostr:nevent…`, as a chip from the `[` menu does,
 * not the URL.
 */

export type ResolvePastedUrl = (url: string) => Promise<UrlReference | null>

type Pending = { id: number; from: number; to: number; url: string }

const key = new PluginKey<Pending[]>('pastedUrl')

/** The one URL a clipboard holds, or null when it holds anything else. */
export function loneUrl(text: string): string | null {
  const trimmed = text.trim()
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null
  try {
    new URL(trimmed)
    return trimmed
  } catch {
    return null
  }
}

/** The body marker a resolved link is written as, or null for one that stays a link. */
export function chipUriOf(ref: UrlReference | null): string | null {
  if (!ref) return null
  if (ref.eventId !== undefined) return `nostr:${encodeNevent({ id: ref.eventId, relays: [] })}`
  if (ref.block !== undefined) return null
  return `nostr:${encodeNaddr(addressToPointer(ref.address))}`
}

let nextId = 0

export const PastedUrl = Extension.create<{ resolve: ResolvePastedUrl }>({
  name: 'pastedUrl',

  addOptions() {
    return { resolve: referenceFromPastedUrl }
  },

  addProseMirrorPlugins() {
    const { resolve } = this.options
    return [
      new Plugin<Pending[]>({
        key,
        state: {
          init: () => [],
          apply(tr, pending) {
            const meta = tr.getMeta(key) as { add?: Pending; drop?: number } | undefined
            let next = pending.flatMap((p) => {
              const from = tr.mapping.mapResult(p.from, 1)
              const to = tr.mapping.mapResult(p.to, -1)
              return from.deleted || to.deleted || to.pos <= from.pos ? [] : [{ ...p, from: from.pos, to: to.pos }]
            })
            if (meta?.drop !== undefined) next = next.filter((p) => p.id !== meta.drop)
            if (meta?.add) next = [...next, meta.add]
            return next
          },
        },
        props: {
          handlePaste(view, event) {
            const url = loneUrl(event.clipboardData?.getData('text/plain') ?? '')
            const { state } = view
            const { schema, selection } = state
            // Over selected words it is the Link extension's: a link on them.
            if (!url || !selection.empty || !schema.nodes.objectMention) return false
            if (selection.$from.parent.type.spec.code || selection.$from.marks().some((m) => m.type.spec.code)) return false

            const link = schema.marks.link
            const text = schema.text(url, link ? [link.create({ href: url })] : [])
            const tr = state.tr.replaceSelectionWith(text, false)
            // Where it landed, which is not always where the caret was.
            const to = tr.selection.from
            const id = ++nextId
            tr.setMeta(key, { add: { id, from: to - url.length, to, url } })
            view.dispatch(tr.scrollIntoView())

            void resolve(url)
              .then(chipUriOf, () => null)
              .then((uri) => {
                if (view.isDestroyed) return
                view.dispatch(swap(view.state, id, uri))
              })
            return true
          },
        },
      }),
    ]
  },
})

/** Replace a pending link with its chip if its text is still the URL; forget it either way. */
function swap(state: EditorState, id: number, uri: string | null): Transaction {
  const tr = state.tr.setMeta(key, { drop: id })
  const pending = key.getState(state)?.find((p) => p.id === id)
  if (!pending || !uri) return tr.setMeta('addToHistory', false)
  if (state.doc.textBetween(pending.from, pending.to) !== pending.url) return tr.setMeta('addToHistory', false)
  // Its own undo step: an answer inside history's 500 ms window would otherwise
  // join the paste, and Ctrl+Z would take the link away with the chip.
  return closeHistory(tr).replaceWith(pending.from, pending.to, state.schema.nodes.objectMention.create({ uri }))
}
