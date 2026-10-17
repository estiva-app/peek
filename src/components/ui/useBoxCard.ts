import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Embed } from '@estiva-app/protocol'
import { askLinks, knownBlockOfUrl, knownCardValue } from '@/api'
import { boxLinksOf, embedsToEdit, embedsToSend, namedBefore, type BoxLinkContext, type BoxLinks } from '@/lib/boxCard'
import { findUrls, serializeTiptapToText } from '@/lib/textParsing'

/*
  The card under a message box, as it will be sent (why:
  https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md):
  the same rule in the message box, the reply box and a message's edit box
  (`lib/boxCard`); `BoxCardUnder` draws it.
*/

/** How many of a box's links are asked what they name: `LinkChips`' own limit. */
const ASKED = 24

const CONTEXT: Pick<BoxLinkContext, 'resolveLink' | 'blockOf'> = { resolveLink: knownCardValue, blockOf: knownBlockOfUrl }

function linksOf(body: string, here: string | undefined, previousBody: string | undefined): BoxLinks {
  return boxLinksOf(body, { ...CONTEXT, here, previous: previousBody === undefined ? undefined : namedBefore(previousBody, CONTEXT) })
}

export interface BoxCard {
  /** What the text names, with its default card before any ✕. */
  links: BoxLinks
  /** The card shown under the box: the default, unless ✕ took it off. */
  card?: string
  /** ✕ on the card. */
  remove: () => void
  /** The `embed` set a new message sends, read from the editor now (Enter reads it from a first-render closure). */
  toSend: () => Embed[]
  /** The `embed` set an edit saves, or undefined to leave the message's as it was. */
  toEdit: (folded: readonly Embed[] | undefined) => Embed[] | undefined
  /** What ✕ took off, for a refused send to put back with its text. */
  removed: () => ReadonlySet<string>
  restore: (removed: ReadonlySet<string>) => void
}

/**
 * The card and parts under a box. `here` is the file whose conversation this
 * is. `previousBody` makes it an edit's: a file the message already named gets
 * no default again, so a card removed with ✕ stays removed.
 */
export function useBoxCard(editor: Editor | null, { here, previousBody }: { here?: string; previousBody?: string } = {}): BoxCard {
  const [text, setText] = useState('')
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set())
  // Bumped as answers come back, so what each link names is read again.
  const [, setAnswered] = useState(0)
  // Read by send and save, which run from the editor's first-render closures.
  const latest = useRef({ removed, here, previousBody })
  useEffect(() => {
    latest.current = { removed, here, previousBody }
  })

  useEffect(() => {
    if (!editor) return
    const read = () => {
      const body = serializeTiptapToText(editor)
      setText(body)
      // A link taken out and put back is linked afresh and gets its card again (§13.6.2), so ✕ forgets a file the text no longer names.
      const values = new Set(linksOf(body, latest.current.here, latest.current.previousBody).values)
      setRemoved((was) => ([...was].every((value) => values.has(value)) ? was : new Set([...was].filter((value) => values.has(value)))))
    }
    read()
    editor.on('update', read)
    return () => {
      editor.off('update', read)
    }
  }, [editor])

  const urlKey = [...new Set([...findUrls(text), ...findUrls(previousBody ?? '')])].slice(0, ASKED).join('\n')
  useEffect(() => {
    if (!urlKey) return
    let live = true
    const bump = () => live && setAnswered((n) => n + 1)
    // A read that failed is asked again on the next change; what did come back is drawn now.
    askLinks(urlKey.split('\n')).then(bump, bump)
    return () => {
      live = false
    }
  }, [urlKey])

  const links = linksOf(text, here, previousBody)
  const card = links.card && !removed.has(links.card) ? links.card : undefined

  const now = () => {
    const { here: on, previousBody: before } = latest.current
    return linksOf(editor ? serializeTiptapToText(editor) : '', on, before)
  }
  return {
    links,
    card,
    remove: () => {
      const value = links.card
      if (value) setRemoved((was) => new Set([...was, value]))
    },
    toSend: () => (editor ? embedsToSend(now(), latest.current.removed) : []),
    toEdit: (folded) => (editor ? embedsToEdit(now(), latest.current.removed, folded) : undefined),
    removed: () => latest.current.removed,
    restore: (back) => setRemoved(new Set(back)),
  }
}
