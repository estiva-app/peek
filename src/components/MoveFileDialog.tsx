import { useId, useState } from 'react'
import { Form } from '@estiva-app/ui'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { DialogShell } from './ui/DialogShell'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Field } from './ui/Field'

/**
 * Move one file to another Folder — RFC 0.4 §2, where a Folder is an
 * association and moving is re-associating.
 *
 * **A `Select`, not a menu of destinations.** `Menu.mdx` sends picking one
 * value to `Select` — "the same shell behaviour plus a trigger that shows the
 * value" — and the workspace has upwards of eighty Folders, so a menu of them
 * would be a scroll with no way to tell where you are in it. `Select`'s
 * geometry is capped and scrollable, which is the tested version of that.
 *
 * **The current Folder is not offered.** Moving a file where it already is has
 * no effect, so the row would be an action that cannot do anything — the app's
 * "only offer actions that can succeed" rule. The writer treats it as a no-op
 * as well, because this dialog is not the only caller.
 *
 * **Not `AddToOpenWorkDialog`'s row list.** That is the nearest existing
 * pattern and it hand-rolls `role="option"` and uses `text-sm`, both of which
 * the gate lint and the token lint now refuse; the files that predate them
 * are not a pattern to copy. One destination is a value, so a `Field` and a `Select` say
 * it with components the package already owns.
 */
export function MoveFileDialog({
  file,
  from,
  folders,
  onMove,
  onClose,
}: {
  file: ForeignObject
  /** The Folder it is in now, which is therefore not a destination. */
  from: string
  folders: FolderSummary[]
  /** Resolves false to keep the dialog open — the caller has said why. */
  onMove: (to: string) => Promise<boolean>
  onClose: () => void
}) {
  const candidates = folders.filter((folder) => folder.id !== from)
  const [to, setTo] = useState(candidates[0]?.id ?? '')
  const [moving, setMoving] = useState(false)
  const formId = useId()

  const title = file.slots.title?.value ?? 'this file'

  async function move() {
    if (!to || moving) return
    setMoving(true)
    const ok = await onMove(to)
    setMoving(false)
    if (ok) onClose()
  }

  return (
    <DialogShell
      title="Move to folder"
      onClose={onClose}
      footer={
        <>
          <Button variant="muted" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={!to || moving}>
            {moving ? 'Moving…' : 'Move'}
          </Button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <p className="text-body-2 text-text-secondary">
          There is nowhere else to move it — this is your only folder.
        </p>
      ) : (
        // The package Form (UIG-7): Ctrl+Enter or Move sends; the list picks with Enter.
        <Form id={formId} busy={moving} onSubmit={move} className="flex flex-col gap-2">
          {/*
            The title on its own line. Inline, a long one ran into the sentence
            around it — "Moving Folders: navigation for the whole suite files it
            elsewhere" — which is unreadable, and Ship's titles are sentences.
          */}
          <p className="text-body-2-strong text-text-primary">{title}</p>
          <p className="text-body-2 text-text-secondary">
            Filing it elsewhere does not change it — it stays exactly as it is in{' '}
            {file.appName ?? 'its own app'}.
          </p>
          <Field label="Destination folder">
            <Select
              value={to}
              onChange={setTo}
              options={candidates.map((folder) => ({
                // A Folder with no state event carries only its channel's name,
                // and an app-created channel may have none — so the id is the
                // ordinary fallback here, not a defensive branch.
                value: folder.id,
                label: folder.name ?? folder.id,
              }))}
              ariaLabel="Destination folder"
            />
          </Field>
        </Form>
      )}
    </DialogShell>
  )
}
