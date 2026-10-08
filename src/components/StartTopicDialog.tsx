import { useId, useState } from 'react'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { EmptyState, Form } from '@estiva-app/ui'
import { DialogShell } from './ui/DialogShell'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { Select } from './ui/Select'
import { TextInput } from './ui/TextInput'

/**
 * Start a topic — a bare file inside this Folder, SPEC §6.7.
 *
 * One field, because a topic *is* one field: a title, and a conversation that
 * every file already has. There is no body to ask for; the day somebody wants
 * a brief at the top they type it into the file, and nothing converts.
 *
 * `parent` is the file the topic sits under, when it was started from a row —
 * a project, an issue, another topic, or a kind this app has never met. Said
 * plainly in the dialog, because "under" is a real relation with a real
 * consequence: Ship draws the topic on that file's page as *Related*, and it
 * is what makes the topic nest in both apps' folder views rather than sit as
 * a peer. Nesting organises and never grants access (RFC 0.4): the topic's
 * readers are the team's, whatever it sits under.
 *
 * ## Where it goes
 *
 * Two modes, and the difference is whether the caller already knows. Started
 * from a Folder or a row, the destination is that Folder and the dialog only
 * names it. Started from the column header (FOL-41) there is no Folder in
 * hand, so `folders` is passed and the dialog asks — a `Select`, the same
 * shape and for the same reason as `MoveDialog`'s: one value out of a list
 * that runs to dozens.
 *
 * **Not the old Start topic dialog** ([CreateTopicDialog]), whose second field
 * invites people. That one makes a Convex topic, where membership is the
 * topic's own; a bare file has no invitee list on the wire and could not honour
 * one — its readers are the Folder's, which is what choosing the Folder
 * decides. So the layout is that dialog's and the second field is the
 * destination.
 */
export function StartTopicDialog({
  folderName,
  folders,
  defaultFolder,
  parent,
  onCreate,
  onClose,
}: {
  /** The Folder it goes in, when the caller already knows — ignored if `folders` is passed. */
  folderName?: string
  /**
   * The Folders to choose between. Present only when the caller has no Folder
   * in hand; every one of them has folder state, which is what `topLevelFolders`
   * selects on, so the write's `hasState` is read rather than guessed.
   */
  folders?: FolderSummary[]
  /** Which of `folders` starts chosen — the open Folder, when there is one. */
  defaultFolder?: string
  parent?: ForeignObject
  /** `folder` is the chosen Folder's id, and is absent unless `folders` was passed. */
  onCreate: (title: string, folder?: string) => Promise<boolean>
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [folder, setFolder] = useState(
    () => (defaultFolder && folders?.some((f) => f.id === defaultFolder) ? defaultFolder : folders?.[0]?.id) ?? '',
  )
  const [creating, setCreating] = useState(false)
  const formId = useId()
  const parentTitle = parent?.slots.title?.value ?? 'this file'
  const trimmed = title.trim()
  const choosing = folders !== undefined
  /*
    A Folder with no state event carries only its channel's name, and an
    app-created channel may carry none — so the id is the ordinary fallback
    here, as it is in the tree and in `MoveDialog`, not a defensive branch.
  */
  const chosen = folders?.find((f) => f.id === folder)
  const where = choosing ? (chosen?.name ?? chosen?.id ?? 'the folder') : (folderName ?? 'this folder')
  const ready = !!trimmed && (!choosing || !!folder)

  async function create() {
    if (!ready || creating) return
    setCreating(true)
    const ok = await onCreate(trimmed, choosing ? folder : undefined)
    setCreating(false)
    if (ok) onClose()
  }

  return (
    <DialogShell
      title={parent ? `Start a topic under ${parentTitle}` : 'Start a topic'}
      onClose={onClose}
      footer={
        <>
          <Button variant="muted" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={!ready || creating}>
            {creating ? 'Starting…' : 'Start'}
          </Button>
        </>
      }
    >
      {choosing && folders.length === 0 ? (
        <EmptyState scope="section" message="There is nowhere to start one yet — make a folder first." />
      ) : (
      /* The package Form (UIG-7): Enter in the title and the footer's Start send it the same way. */
      <Form id={formId} busy={creating} onSubmit={create}>
        <p className="text-body-2 text-text-secondary">
          {parent
            ? `A conversation about one part of ${parentTitle}. Everyone in ${where} can read it, and ${parent.appName ?? 'its app'} shows it there as related.`
            : `A conversation in ${where}. Everyone in the folder can read it.`}
        </p>
        <Field label="Title">
          <TextInput
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What is it about?"
            aria-label="Topic title"
            autoFocus
          />
        </Field>
        {choosing && (
          <Field label="Folder">
            <Select
              value={folder}
              onChange={setFolder}
              options={folders.map((candidate) => ({
                value: candidate.id,
                label: candidate.name ?? candidate.id,
              }))}
              ariaLabel="Folder"
            />
          </Field>
        )}
      </Form>
      )}
    </DialogShell>
  )
}
