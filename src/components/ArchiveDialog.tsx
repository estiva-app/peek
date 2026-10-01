import { useId, useState } from 'react'
import { Form } from '@estiva-app/ui'
import { Button } from '@/components/ui/Button'
import { DialogShell } from '@/components/ui/DialogShell'
import { Field } from '@/components/ui/Field'
import { Textarea } from '@/components/ui/Textarea'
import { listOf } from '@/lib/archiveWords'

/**
 * The question asked before archiving a file or a Folder (FOL-46): what goes
 * out of the lists with it, counted, and an optional resolution summary.
 *
 * The counts are interop's `archiveImpact`, read before this opens, so Peek and
 * Ship warn with the same numbers; the sentences are Ship's `ArchiveDialog`'s,
 * so a person archiving in either app reads the same thing. Archive hides and
 * never deletes, so the confirm is not destructive, and the last line says how
 * to get it all back.
 *
 * A `DialogShell` with a `Form`, not a `ConfirmDialog` (1 October): it asks
 * for a resolution, and a question with a field is a form. So Ctrl+Enter
 * archives from the field, the field is switched off while it archives, and
 * Escape or a press outside closes it, as every other dialog with fields does.
 * @registry reusable: stays in Peek: estiva-ui's DialogShell and Form with Peek's archive words
 */
export interface ArchiveDialogProps {
  /** The file's name, for the title. */
  title: string
  /** What it is, in a word: "topic", "project", "issue", "folder". */
  what: string
  /** What goes out of the lists with it, already counted and worded — "14 issues". Empty: nothing else. */
  hides: string[]
  /** What it lists that stays visible somewhere else, worded — "2 files also in Steer". */
  staysVisible?: string[]
  onClose: () => void
  /** Resolve `false` to keep the dialog open (the caller has said why). */
  onArchive: (resolution: string) => Promise<boolean>
}

export function ArchiveDialog({ title, what, hides, staysVisible = [], onClose, onArchive }: ArchiveDialogProps) {
  const [resolution, setResolution] = useState('')
  const [busy, setBusy] = useState(false)
  const formId = useId()
  const archive = async () => {
    setBusy(true)
    try {
      if ((await onArchive(resolution.trim())) !== false) onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <DialogShell
      title={`Archive “${title}”?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="muted" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={busy}>
            {`Archive ${what}`}
          </Button>
        </>
      }
    >
      {/* The package Form (UIG-7): Ctrl+Enter archives from the resolution; Enter there is a new line. */}
      <Form id={formId} busy={busy} onSubmit={() => void archive()}>
        {/* The words are one block, 8px apart, before the field; the Form puts 24px between them, as MoveDialog does (1 October). */}
        <div className="flex flex-col gap-2 text-body-2 text-text-primary">
          <p>
            {hides.length
              ? `This hides the ${what} and ${listOf(hides)} from every list, in Peek and in Ship.`
              : `This hides the ${what} from every list, in Peek and in Ship.`}
          </p>
          {staysVisible.length > 0 && <p>{`${listOf(staysVisible)} stay visible there.`}</p>}
          <p className="text-text-secondary">
            Nothing is deleted: a link still opens it, and Unarchive brings everything back as it was.
          </p>
        </div>
        <Field label="Resolution (optional)">
          <Textarea
            value={resolution}
            rows={3}
            placeholder={`What happened with this ${what}? Shown first to anyone who opens it.`}
            onChange={(event) => setResolution(event.target.value)}
          />
        </Field>
      </Form>
    </DialogShell>
  )
}
