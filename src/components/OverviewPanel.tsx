import type { ReactNode } from 'react'
import { Panel } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import { MessageCard } from '@/components/ui/MessageLinks'
import { referenceOfValue } from '@/lib/embedValue'

/**
 * **A file's third column while no thread is open: its Overview** (Katerina,
 * 7 October). One title whatever is in it: another app's card when the file
 * is that app's, and Activity under it.
 *
 * ## The card — FOL-29
 *
 * RFC 0.5 §10.2 gives a file three parts — document, properties, conversation
 * — and says each app renders the ones it owns. The middle column is Peek's
 * part, the conversation. The card is the owning app's part, drawn as Peek
 * draws it under a message: the kit's card (Katerina, 30 Oct: "the kit's card,
 * not its own"), its title the way into the app that owns it, its key and
 * kind, its summary, its comment count, and its status and owner as the
 * manifest's pickers. A bare file is nobody's, so it has no card.
 *
 * The page has already resolved the file — it is what the middle column
 * draws — so the card is handed the object rather than the address, and no
 * second read is made for the same event. A pick on it is written and read
 * back, since the relay is the authority on whether it happened.
 *
 * ## One scroll
 *
 * The card and Activity scroll together in one body (Katerina, 27 September):
 * two scrolls in one column were two cramped boxes.
 */
export function OverviewPanel({ file, activity }: {
  /** Another app's file, for its card. Absent for a file Peek owns. */
  file?: ForeignObject
  /** The Activity section, `FileActivityPanel`. Absent where mentions are not read. */
  activity?: ReactNode
}) {
  const reference = file?.naddr ? `nostr:${file.naddr}` : file?.address ? referenceOfValue(file.address) : undefined
  return (
    <Panel title="Overview" bodyClassName="flex flex-col pb-4">
      {reference && file && (
        // 16px above the card puts its edge at the column's 16px inset. `pb-2`: 24px between the card and Activity, with
        // the section's own 16px (Katerina, 7 October).
        <div className="px-4 pb-2 pt-4" data-file-widget={file.address}>
          {/* `key`: FilePage stays mounted from one file to the next, and a card holding the last file's object with the
              next one's address would write a pick to the wrong file. */}
          <MessageCard key={reference} uri={reference} resolved={file} />
        </div>
      )}
      {activity}
    </Panel>
  )
}
