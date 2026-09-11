import { useState } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { DialogShell } from './ui/DialogShell'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
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
 */
export function StartTopicDialog({
  folderName,
  parent,
  onCreate,
  onClose,
}: {
  folderName: string
  parent?: ForeignObject
  onCreate: (title: string) => Promise<boolean>
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const parentTitle = parent?.slots.title?.value ?? 'this file'
  const trimmed = title.trim()

  async function create() {
    if (!trimmed || creating) return
    setCreating(true)
    const ok = await onCreate(trimmed)
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
          <Button variant="primary" disabled={!trimmed || creating} onClick={() => void create()}>
            {creating ? 'Starting…' : 'Start'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-body-2 text-text-secondary">
          {parent
            ? `A conversation about one part of ${parentTitle}. Everyone in ${folderName} can read it, and ${parent.appName ?? 'its app'} shows it there as related.`
            : `A conversation in ${folderName}. Everyone in the folder can read it.`}
        </p>
        <Field label="Title">
          <TextInput
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create()
            }}
            placeholder="What is it about?"
            aria-label="Topic title"
            autoFocus
          />
        </Field>
      </div>
    </DialogShell>
  )
}
