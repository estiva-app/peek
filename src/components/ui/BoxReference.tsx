import { useContext } from 'react'
import { LinkChip } from '@estiva-app/ui'
import type { ReferenceViewProps } from '@estiva-app/ui/editor'
import { useDeleted, useLinksIn, useResolvedReferences } from '@/api'
import { linkStateOf, messageWordsOf } from '@/lib/linked'
import { BoxSupplied, suppliedFor } from './boxSupplied'
import { Reference } from './Reference'

const isPerson = (uri: string) => /^nostr:npub1/i.test(uri)

/**
 * A `nostr:` reference or an app link the box holds, as the kit's `LinkChip`,
 * from the same lookup the sent message's chip reads (Katerina, 30 Oct: one
 * chip in every box, for a pasted link and a `[` pick alike, which the kit
 * draws through this since ui 0.92). A chip wherever it sits. While it is
 * written (`editing`) hovering shows no card, and the kit holds a click on it,
 * so it is not a way out of the draft. A person is their name's chip, as in
 * the sent message. An app link not answered yet reads as the URL it was
 * written as, and one that cannot be read stays that URL (SPEC §13.1).
 */
export function BoxReference({ uri, href, editing = true }: ReferenceViewProps) {
  const supplied = suppliedFor(useContext(BoxSupplied), uri)
  // Asked for only when nothing was handed in, and never for a person, whom the directory names; the hook is called either way.
  const fetched = useResolvedReferences(supplied || !uri || isPerson(uri) ? [] : [uri])
  const object = supplied ?? fetched[uri]
  const deleted = useDeleted(uri, object)
  useLinksIn(messageWordsOf(object))
  if (!uri) return <span>{href}</span>
  if (isPerson(uri)) return <Reference uri={uri} link={false} />
  return <LinkChip link={linkStateOf(uri, object, { url: href, deleted })} preview={!editing} />
}
