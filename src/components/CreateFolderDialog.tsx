import { useId, useState } from 'react'
import { Form } from '@estiva-app/ui'
import { DialogShell } from './ui/DialogShell'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { TextInput } from './ui/TextInput'

/**
 * Make a Folder — the header's action, FOL-41.
 *
 * **A dialog, not the row that was there.** The Folders column carried the
 * create inline: a text field and a Create button wedged above the tree, which
 * is a 290px column asked to hold a form as well as the navigation. It had
 * already been clipped once for exactly that reason (Katerina, 2026-09-11),
 * and it put a permanent write control above a list somebody reads all day.
 * The header's three actions are the Topics column's pattern (`TopicsPage`),
 * and a modal is where the workspace's other creates live.
 *
 * One field, like the row it replaces. A Folder is a name and nothing else on
 * the wire — the relay mints the channel and its state (§4.1) — so there is
 * nothing further to ask for, and the day a Folder has a description this is
 * where it goes.
 */
export function CreateFolderDialog({
  rename,
  onCreate,
  onClose,
}: {
  /**
   * The Folder's name today: the dialog renames it instead — "Rename folder",
   * the name filled in, a Rename button (Katerina, 5 October): with the
   * Folders page gone, a Folder is renamed from its heading's ⋮
   * (`useFolderActions`), and Peek had no dialog for it — the page renamed in
   * place.
   */
  rename?: string
  /** Resolves false to keep the dialog open — the caller has said why. */
  onCreate: (name: string) => Promise<boolean>
  onClose: () => void
}) {
  const [name, setName] = useState(rename ?? '')
  const [creating, setCreating] = useState(false)
  const formId = useId()
  const trimmed = name.trim()
  // A rename to the name it already has would write and change nothing (5 October).
  const unchanged = rename !== undefined && trimmed === rename.trim()

  async function create() {
    if (!trimmed || unchanged || creating) return
    setCreating(true)
    const ok = await onCreate(trimmed)
    setCreating(false)
    if (ok) onClose()
  }

  return (
    <DialogShell
      title={rename !== undefined ? 'Rename folder' : 'New folder'}
      onClose={onClose}
      footer={
        <>
          <Button variant="muted" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={!trimmed || unchanged || creating}>
            {rename !== undefined ? (creating ? 'Renaming…' : 'Rename') : creating ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      {/* The package Form (UIG-7): Enter in the field and the footer's Create send it the same way. */}
      <Form id={formId} busy={creating} onSubmit={create}>
        {rename === undefined && (
          <p className="text-body-2 text-text-secondary">
            A place for files and conversations. Everyone you add to it can read what is in it.
          </p>
        )}
        {/*
          "Folder name", the label the row above the list carried — `Field`
          wires `aria-labelledby`, which wins over an `aria-label`, so the
          label *is* the accessible name and a second one would only be the
          name that loses.
        */}
        <Field label="Folder name">
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="What is it for?"
            autoFocus
          />
        </Field>
      </Form>
    </DialogShell>
  )
}
