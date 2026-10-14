/**
 * Which card each reference in a message gets — none, compact or detailed
 * (SPEC §13.6.2, OPT-17, Widgets).
 *
 * **One choice per value, not per chip.** The wire carries one `embed` per
 * address or event id, and a reader takes the first, so two chips for the same
 * issue are one choice: the map is keyed by the value, and setting it on either
 * sets it for both. That is also why the choice lives here rather than on the
 * nodes: a node attribute could say two different things for one value, and
 * the message could only send one of them.
 *
 * **What offers a card.** A chip for an object, a message or an app URL
 * (`objectMention`, `messageMention`, `reference`), and a link on words whose
 * URL names one by §7.7 — looked
 * up once per link (`cardValueOfUrl`), so a link is offered a card only after
 * the relay has said what it names. A person, a link to one block (it draws
 * that block, §13.6.1) and a URL no app claims are not.
 *
 * **Not a draft.** A draft keeps text, and the choice is not text, so a message
 * that comes back from a draft has its chips at none. Sending and editing are
 * where the choice is kept.
 */
import { Extension, type Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Embed, EmbedLayout } from '@estiva-app/protocol'
import { cardValueOfUrl } from '@/api'
import { valueOfReference } from '@/lib/embedValue'

/** The chips that offer a card: every reference chip but a person's, and an app URL's (OPT-19). */
const CHIP_NODES = new Set(['objectMention', 'messageMention', 'reference'])

/** A reference in the message as written: what it names, and where it is. */
export interface WrittenReference {
  value: string
  from: number
  to: number
  /** A chip is a node; a link is a run of words. */
  kind: 'chip' | 'link'
}

export interface CardChoicesStorage {
  /** The layout chosen for each value. A value not here is `none`. */
  layouts: Map<string, EmbedLayout>
  /** What each link's URL names, once asked: a value, or null for nothing. */
  links: Map<string, string | null>
}

/** Asked of the relay, so injected: a test hands in its own answers. */
export type LinkCardValue = (url: string) => Promise<string | null>

const key = new PluginKey<DecorationSet>('cardChoices')
const REFRESH = 'cardChoices:refresh'

function storageOf(editor: Editor): CardChoicesStorage | undefined {
  return (editor.storage as unknown as { cardChoices?: CardChoicesStorage }).cardChoices
}

const isAppUrl = (href: unknown): href is string => typeof href === 'string' && /^https?:\/\//i.test(href)

/** Every chip and every link that names something, in document order. Adjacent runs of one link are one link. */
export function writtenReferences(doc: PmNode, links: ReadonlyMap<string, string | null>): WrittenReference[] {
  const out: WrittenReference[] = []
  let open: { href: string; ref: WrittenReference } | null = null
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false
    if (CHIP_NODES.has(node.type.name)) {
      open = null
      const value = typeof node.attrs.uri === 'string' ? valueOfReference(node.attrs.uri) : undefined
      if (value) out.push({ value, from: pos, to: pos + node.nodeSize, kind: 'chip' })
      return false
    }
    if (!node.isText) {
      if (node.isInline) open = null
      return true
    }
    const href = node.marks.find((mark) => mark.type.name === 'link')?.attrs.href
    if (node.marks.some((mark) => mark.type.spec.code) || !isAppUrl(href)) {
      open = null
      return false
    }
    const value = links.get(href)
    if (!value) {
      open = null
      return false
    }
    if (open && open.href === href && open.ref.to === pos) open.ref.to = pos + node.nodeSize
    else {
      const ref: WrittenReference = { value, from: pos, to: pos + node.nodeSize, kind: 'link' }
      out.push(ref)
      open = { href, ref }
    }
    return false
  })
  return out
}

/**
 * The reference the person is on: a selected chip, the chip just before the
 * caret — where a paste or a `[` pick leaves it — or the link the caret or the
 * selection is in.
 */
export function referenceAtSelection(state: EditorState, links: ReadonlyMap<string, string | null>): WrittenReference | null {
  const written = writtenReferences(state.doc, links)
  const { selection } = state
  if (selection instanceof NodeSelection) return written.find((ref) => ref.from === selection.from) ?? null
  const { from, to, empty } = selection
  if (empty) {
    // A `[` pick leaves the caret after the space it adds behind the chip.
    const after = (ref: WrittenReference) => ref.to === from || (ref.to === from - 1 && state.doc.textBetween(ref.to, from) === ' ')
    const before = written.find((ref) => ref.kind === 'chip' && after(ref))
    return before ?? written.find((ref) => ref.kind === 'link' && ref.from <= from && from <= ref.to) ?? null
  }
  return written.find((ref) => ref.from < to && from < ref.to) ?? null
}

/** The layout chosen for a value. */
export function cardOf(editor: Editor, value: string): EmbedLayout {
  return storageOf(editor)?.layouts.get(value) ?? 'none'
}

/** The links the editor knows the value of, for {@link referenceAtSelection}. */
export function knownLinks(editor: Editor): ReadonlyMap<string, string | null> {
  return storageOf(editor)?.links ?? new Map()
}

/** Choose a value's card. Every chip and link for it follows. */
export function setCard(editor: Editor, value: string, layout: EmbedLayout): void {
  const storage = storageOf(editor)
  if (!storage) return
  if (layout === 'none') storage.layouts.delete(value)
  else storage.layouts.set(value, layout)
  editor.view.dispatch(editor.state.tr.setMeta(REFRESH, true).setMeta('addToHistory', false))
}

/** Load the cards a sent message carries — its folded `embed` set — when its edit box opens. */
export function loadCards(editor: Editor, embeds: readonly Embed[] | undefined): void {
  const storage = storageOf(editor)
  if (!storage) return
  storage.layouts.clear()
  for (const embed of embeds ?? []) if (embed.layout !== 'none') storage.layouts.set(embed.value, embed.layout)
  editor.view.dispatch(editor.state.tr.setMeta(REFRESH, true).setMeta('addToHistory', false))
}

/** Forget every choice — a sent message's box starts the next one at none. */
export function clearCards(editor: Editor): void {
  storageOf(editor)?.layouts.clear()
}

/** The values the message names, once each, in the order it first names them. */
function namedValues(editor: Editor): string[] {
  return [...new Set(writtenReferences(editor.state.doc, knownLinks(editor)).map((ref) => ref.value))]
}

/**
 * The `embed` set a new message sends: one per value it names with a card.
 * `none` is not written, because no `embed` already means the reader's default.
 */
export function cardsToSend(editor: Editor): Embed[] {
  return namedValues(editor).flatMap((value) => {
    const layout = cardOf(editor, value)
    return layout === 'none' ? [] : [{ value, layout }]
  })
}

/**
 * The `embed` set an edit sends, or undefined when the cards did not change —
 * an edit carrying none leaves the message's set as it was (§6.8).
 *
 * A set replaces the one before it, so a changed set names every card it
 * keeps, and `none` for each value it takes a card from. Only values the body
 * still names: §13.6.2 forbids an `embed` for anything else, and a card for a
 * value the body no longer names is not drawn anyway.
 */
export function cardsToEdit(editor: Editor, before: readonly Embed[] | undefined): Embed[] | undefined {
  const values = namedValues(editor)
  const had = new Map((before ?? []).map((embed) => [embed.value, embed.layout]))
  const next = values.flatMap((value): Embed[] => {
    const layout = cardOf(editor, value)
    if (layout !== 'none') return [{ value, layout }]
    const was = had.get(value)
    return was && was !== 'none' ? [{ value, layout: 'none' }] : []
  })
  const changed = values.some((value) => cardOf(editor, value) !== (had.get(value) ?? 'none'))
  return changed ? next : undefined
}

/** The card a chip's view draws its marker for, from the decoration this extension puts on it. */
export function cardOfDecorations(decorations: readonly Decoration[] | undefined): EmbedLayout {
  for (const decoration of decorations ?? []) {
    const card = (decoration.spec as { card?: EmbedLayout }).card
    if (card) return card
  }
  return 'none'
}

export const CardChoices = Extension.create<{ cardValue: LinkCardValue }, CardChoicesStorage>({
  name: 'cardChoices',

  addOptions() {
    return { cardValue: cardValueOfUrl }
  },

  addStorage() {
    return { layouts: new Map(), links: new Map() }
  },

  addProseMirrorPlugins() {
    const storage = this.storage
    const { cardValue } = this.options
    const asked = new Set<string>()
    const decorate = (state: EditorState) =>
      DecorationSet.create(
        state.doc,
        writtenReferences(state.doc, storage.links).flatMap((ref) => {
          const card = storage.layouts.get(ref.value)
          // The chip's view draws the marker; a link has none of its own yet.
          return card && ref.kind === 'chip' ? [Decoration.node(ref.from, ref.to, {}, { card })] : []
        }),
      )
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorate(state),
          apply: (tr, set, _, state) => (tr.docChanged || tr.getMeta(REFRESH) ? decorate(state) : set),
        },
        props: {
          decorations: (state) => key.getState(state),
        },
        view: (view) => {
          // Ask what each new link names, once; the answer refreshes the editor so the Card control can offer it.
          const ask = () => {
            view.state.doc.descendants((node) => {
              const href = node.marks.find((mark) => mark.type.name === 'link')?.attrs.href
              if (!isAppUrl(href) || asked.has(href)) return true
              asked.add(href)
              void cardValue(href).then(
                (value) => {
                  storage.links.set(href, value)
                  if (value && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(REFRESH, true).setMeta('addToHistory', false))
                },
                () => asked.delete(href),
              )
              return true
            })
          }
          ask()
          return { update: (_, previous) => void (view.state.doc !== previous.doc && ask()) }
        },
      }),
    ]
  },
})
