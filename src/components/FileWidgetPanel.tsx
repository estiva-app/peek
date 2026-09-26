import { Panel } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import { ForeignObjectWidget } from '@/components/ui/ForeignObjectWidget'

/**
 * **Another app's file, as its widget, in the third column while no thread is
 * open** — FOL-29.
 *
 * RFC 0.5 §10.2 gives a file three parts — document, properties, conversation
 * — and says each app renders the ones it owns. The middle column is Peek's
 * part, the conversation. This is the owning app's part, drawn the way Peek
 * draws it anywhere else: the same card a message shows for a reference to
 * the file, its title the way into the app that owns it, its status and
 * people off the manifest, and the manifest's controls under them. Before
 * this the column stood empty until a thread opened, and what the
 * conversation was *about* was one line in the header and nothing more.
 *
 * ## Why the card, and not a layout of its own
 *
 * `FilesPanel` draws a project as a properties list with a ticket
 * table, because a project is the subject of a whole column there. A file
 * page is the file's own page, so the column is context and not the subject,
 * and the reference card is the right weight for context — the same call
 * Miky made for the Folder listing (2026-09-13: same three panes for every
 * file, the widget the only difference).
 *
 * ## What it takes, and what it does not resolve
 *
 * The page has already resolved the file — it is what the middle column
 * draws — so the widget is handed the object rather than the address, and no
 * second read is made for the same event. The widget still re-reads on its
 * own after one of its controls lands, since the relay is the authority on
 * whether that happened.
 *
 * The header is the app's name: this is that app's aspect of the file, and
 * the column beside it says "Thread" and "Activity" in the same bar.
 */
export function FileWidgetPanel({ file, className }: { file: ForeignObject; /** Placement: a cap when Activity shares the column. */ className?: string }) {
  const reference = file.naddr ?? file.address
  if (!reference) return null
  return (
    // The package's Panel (0.37.0): a long description scrolls instead of running off the column.
    // The widget carries its own `mt-1` from the message it was written for; 12px above it puts the card's edge at the column's 16px inset.
    <Panel title={file.appName ?? 'File'} bodyClassName="px-4 pb-4 pt-3" className={className}>
      <div data-file-widget={file.address}>
        <ForeignObjectWidget naddr={reference} resolved={file} />
      </div>
    </Panel>
  )
}
