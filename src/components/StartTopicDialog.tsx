import { useState } from 'react'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { EmptyState, FormDialog } from '@estiva-app/ui'
import { Field } from './ui/Field'
import { Select } from './ui/Select'
import { TextInput } from './ui/TextInput'
import { SummaryField } from './SummaryField'
import { summaryText } from '@/lib/summary'

/**
 * Start a topic — a bare file inside this Folder, SPEC §6.7.
 *
 * A title, and a conversation that every file already has. There is no body
 * to ask for; the day somebody wants a brief at the top they type it into the
 * file, and nothing converts. The summary under the title is optional (SPEC
 * §6.12, the short-summary prototype's `PeekStartTopic`): one or two
 * sentences, read on the Desk and on cards, changed later in Details.
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
  initialTitle = '',
  initialSummary = '',
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
  /** The title it opens with: a refused topic's, restored (PEE-6). */
  initialTitle?: string
  /** The summary it opens with: a refused topic's, restored with its title. */
  initialSummary?: string
  /**
   * `folder` is the chosen Folder's id, and is absent unless `folders` was
   * passed. `summary` is on one line and trimmed; blank is `''`, no summary.
   */
  onCreate: (title: string, folder: string | undefined, summary: string) => Promise<boolean>
  onClose: () => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [summary, setSummary] = useState(initialSummary)
  const [folder, setFolder] = useState(
    () => (defaultFolder && folders?.some((f) => f.id === defaultFolder) ? defaultFolder : folders?.[0]?.id) ?? '',
  )
  const parentTitle = parent?.slots.title?.value ?? 'this file'
  const trimmed = title.trim()
  const choosing = folders !== undefined
  /*
    A Folder with no state event carries only its channel's name, and an
    app-created channel may carry none — so the id is the ordinary fallback
    here, as it is in the tree and in `MoveDialog`, not a defensive branch.
  */
  const chosen = folders?.find((f) => f.id === folder)
  const where = choosing ? (chosen?.name ?? chosen?.id ?? 'the team') : (folderName ?? 'this team')
  const ready = !!trimmed && (!choosing || !!folder)

  return (
    // The kit's FormDialog (C10): Enter in the title and the footer's Start send it the same way, and it closes once that went through.
    <FormDialog
      title={parent ? `Start a topic under ${parentTitle}` : 'Start a topic'}
      submitLabel="Start"
      busyLabel="Starting…"
      ready={ready}
      onSubmit={() => onCreate(trimmed, choosing ? folder : undefined, summaryText(summary))}
      onClose={onClose}
    >
      {choosing && folders.length === 0 ? (
        <EmptyState scope="section" message="There is nowhere to start one yet — make a team first." />
      ) : (
        <>
          <p className="text-body-2 text-text-secondary">
            {parent
              ? `A conversation about one part of ${parentTitle}. Everyone in ${where} can read it, and ${parent.appName ?? 'its app'} shows it there as related.`
              : `A conversation in ${where}. Everyone in the team can read it.`}
          </p>
          <Field label="Title">
            <TextInput
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What is it about?"
              autoFocus
            />
          </Field>
          <SummaryField value={summary} onChange={setSummary} />
          {choosing && (
            <Field label="Team">
              <Select
                value={folder}
                onChange={setFolder}
                options={folders.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.name ?? candidate.id,
                }))}
                ariaLabel="Team"
              />
            </Field>
          )}
        </>
      )}
    </FormDialog>
  )
}
