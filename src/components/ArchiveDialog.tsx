import { useState } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
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
 * @registry reusable: stays in Peek: estiva-ui's ConfirmDialog with Peek's archive words
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
  return (
    <ConfirmDialog
      title={`Archive “${title}”?`}
      confirmLabel={`Archive ${what}`}
      onClose={onClose}
      onConfirm={() => onArchive(resolution.trim())}
    >
      <p>
        {hides.length
          ? `This hides the ${what} and ${listOf(hides)} from every list, in Peek and in Ship.`
          : `This hides the ${what} from every list, in Peek and in Ship.`}
      </p>
      {staysVisible.length > 0 && <p>{`${listOf(staysVisible)} stay visible there.`}</p>}
      <p className="text-text-secondary">
        Nothing is deleted: a link still opens it, and Unarchive brings everything back as it was.
      </p>
      <Field label="Resolution (optional)">
        <Textarea
          value={resolution}
          rows={3}
          placeholder={`What happened with this ${what}? Shown first to anyone who opens it.`}
          onChange={(event) => setResolution(event.target.value)}
        />
      </Field>
    </ConfirmDialog>
  )
}
