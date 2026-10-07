import type { ReactNode } from 'react'
import { Panel } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import { ForeignObjectWidget } from '@/components/ui/ForeignObjectWidget'

/**
 * **A file's third column while no thread is open: its Overview** (Katerina,
 * 7 October). One title whatever is in it: another app's card when the file
 * is that app's, and Activity under it.
 *
 * ## The card — FOL-29
 *
 * RFC 0.5 §10.2 gives a file three parts — document, properties, conversation
 * — and says each app renders the ones it owns. The middle column is Peek's
 * part, the conversation. The card is the owning app's part, drawn the way
 * Peek draws it anywhere else: the same card a message shows for a reference
 * to the file, its title the way into the app that owns it, its status and
 * people off the manifest, and the manifest's controls under them. A long
 * description is cut behind a fade with "Show more", so the controls and
 * Activity stay in view. A bare file is nobody's, so it has no card.
 *
 * The page has already resolved the file — it is what the middle column
 * draws — so the widget is handed the object rather than the address, and no
 * second read is made for the same event. The widget still re-reads on its
 * own after one of its controls lands, since the relay is the authority on
 * whether that happened.
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
  const reference = file ? (file.naddr ?? file.address) : undefined
  return (
    <Panel title="Overview" bodyClassName="flex flex-col pb-4">
      {reference && file && (
        // The widget carries its own `mt-1` from the message it was written for; 12px above it puts the card's edge at the column's 16px inset.
        // `pb-2`: 24px between the card and Activity, with the section's own 16px (Katerina, 7 October).
        <div className="px-4 pb-2 pt-3" data-file-widget={file.address}>
          {/* `page`: the file is this page's subject, so its description is drawn and edited here even when its widget is a row (MAN-9).
              `key`: FilePage stays mounted from one file to the next, and a widget holding the last file's object with the next one's
              address would save the last description over the next. */}
          <ForeignObjectWidget key={reference} naddr={reference} resolved={file} page clampDescription />
        </div>
      )}
      {activity}
    </Panel>
  )
}
