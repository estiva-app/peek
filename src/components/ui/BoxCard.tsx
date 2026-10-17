import type { ForeignObject } from '@estiva-app/interop'
import { referenceOfValue, valueOfReference } from '@/lib/embedValue'
import { MessageCard, MessagePart } from './MessageLinks'
import { PartCard } from './PartCard'
import type { BoxCard } from './useBoxCard'

/**
 * Under a message box, as it will be sent (why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md):
 * one file's card with its ✕, or the live part of each block link, which has
 * no ✕ (to send without it, delete the link; Miky, 16 Oct). `parts={false}`
 * under an edit box, since an edit carries no `part` (§13.6.1): only the card
 * it adds.
 */
export function BoxCardUnder({ box, parts = true, resolvedObjects }: { box: BoxCard; parts?: boolean; /** The box's seam for a surface with no relay to ask (a story, a test), by reference or address. */ resolvedObjects?: Record<string, ForeignObject> }) {
  const reference = box.card ? referenceOfValue(box.card) : undefined
  // By the file, not the spelling: a seam's `naddr` may carry relay hints the value's does not.
  const resolved = box.card
    ? Object.entries(resolvedObjects ?? {}).find(([key]) => valueOfReference(key.startsWith('nostr:') ? key : `nostr:${key}`) === box.card)?.[1]
    : undefined
  const shown = parts ? box.links.parts : []
  if (!reference && shown.length === 0) return null
  return (
    <div data-box-under className="flex flex-col gap-2">
      {shown.map((part) => (
        <MessagePart key={part.address}>
          <PartCard address={part.address} block={part.block} />
        </MessagePart>
      ))}
      {reference && <MessageCard key={reference} uri={reference} resolved={resolved} onRemove={box.remove} />}
    </div>
  )
}
