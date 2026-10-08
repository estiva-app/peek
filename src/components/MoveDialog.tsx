import { useId, useRef, useState } from 'react'
import { EmptyState, Form } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import type { MoveTarget } from '@/lib/moveTargets'
import { DialogShell } from './ui/DialogShell'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Field } from './ui/Field'

const TOP = '__top__'

/** A Folder a file may be moved to — a top-level one, which is what both apps navigate by. */
export interface MoveFolder {
  id: string
  name: string
}

/** Where the person put it: the Folder, and — for a file that nests — what it goes under. */
export interface MoveChoice {
  folder: string
  /** The new parent's address, `''` for the top (or, for an issue, no project). Absent when the file does not nest. */
  parent?: string
}

/**
 * Move a file: to another Folder, under another file, or both (FOL-45).
 *
 * One dialog for every file, from the file's menu, its row in the tree, and the
 * Folder pane — until FOL-45 there were two, one per question: `MoveFileDialog`
 * changed the Folder and `MoveUnderDialog` changed the parent inside it, so a
 * topic could not be moved into another Folder from its own page and an issue
 * could not leave its team at all.
 *
 * **The Folder first, then what it goes under there.** Two `Select`s, because
 * each is one value out of a list (`Menu.mdx` sends that to `Select`), and the
 * second is read from the first: which files a Folder holds is that Folder's
 * listing, read when it is picked — not guessed and not read for every Folder
 * up front.
 *
 * - A **topic** goes at the top of the Folder or under any file in it.
 * - An **issue** goes under a project, so its list is that Folder's projects
 *   (`parentKind`); it moves Folder by moving project, which is how Ship moves
 *   one.
 * - A **project** nests under nothing, so it is asked only for the Folder, and
 *   the one it is in is not offered — moving it there would do nothing.
 *
 * In the Folder it is already in, only real moves are listed — never where it
 * is now (`moveTargetsIn`), the "only offer actions that can succeed" rule.
 */
export function MoveDialog({
  file,
  from,
  folders,
  nests,
  targets: initialTargets,
  targetsIn,
  onMove,
  onClose,
}: {
  file: ForeignObject
  /** The Folder it is in now (`currentFolderOf`). */
  from: string
  /** The Folders it may go to. Each has state: a move into one without would hide what is there (FOL-10). */
  folders: MoveFolder[]
  /** Whether it can be put under another file — its manifest declares the field that moves it. */
  nests: boolean
  /** Where it may go in `from`, already read by the caller. */
  targets?: MoveTarget[]
  /** Where it may go in another Folder. A rejection is said in the dialog, beside a Try again. */
  targetsIn: (folder: string) => Promise<MoveTarget[]>
  /** Resolves false to keep the dialog open — the caller has said why. */
  onMove: (choice: MoveChoice) => Promise<boolean>
  onClose: () => void
}) {
  const destinations = nests ? folders : folders.filter((folder) => folder.id !== from)
  /*
    Open on the Folder it is in, whose targets the caller read — or on none,
    so Move waits for a pick. A project was moved into the first Folder in the
    list by one Move pressed without a pick, on production (FOL-45): a
    preselected destination is a move the person did not choose. Another
    Folder's targets are read when it is picked, never during render.
  */
  const [folder, setFolder] = useState(() => (destinations.some((candidate) => candidate.id === from) ? from : ''))
  const [read, setRead] = useState<Record<string, MoveTarget[] | 'reading' | 'failed'>>(() =>
    initialTargets ? { [from]: initialTargets } : {},
  )
  const [picked, setPicked] = useState<string | undefined>()
  const [moving, setMoving] = useState(false)
  const formId = useId()

  // The Folders read or being read, known now rather than at the next render:
  // two picks of one Folder before its read lands would otherwise read it twice.
  const requested = useRef(new Set(initialTargets ? [from] : []))
  const readTargets = (id: string) => {
    if (!nests || requested.current.has(id)) return
    requested.current.add(id)
    setRead((current) => ({ ...current, [id]: 'reading' }))
    targetsIn(id).then(
      (targets) => setRead((current) => ({ ...current, [id]: targets })),
      () => {
        requested.current.delete(id)
        setRead((current) => ({ ...current, [id]: 'failed' }))
      },
    )
  }
  const chooseFolder = (id: string) => {
    setFolder(id)
    setPicked(undefined)
    readTargets(id)
  }

  const title = file.slots.title?.value ?? 'this file'
  const folderName = destinations.find((candidate) => candidate.id === folder)?.name ?? 'this folder'
  const status = nests ? read[folder] : undefined
  const targets = Array.isArray(status) ? status : []
  const valueOf = (target: MoveTarget) => target.file?.address ?? TOP
  /*
    Only the top is chosen for the person, and only for a topic: it is where a
    file lands in a Folder unless somebody says otherwise. Any other first row
    is an accident of order — an issue moved to Steer went under the first
    project listed there, a live one, on production (FOL-45).
  */
  const parent = picked ?? (file.parentKind === undefined && targets[0] && !targets[0].file ? TOP : undefined)
  /*
    The empty target is "the top" only for a file that may sit under any file.
    One whose move names a kind (`parentKind` — a Ship issue, whose move is a
    `project` change, MAN-4) is taken out of its parent by it, not placed in
    the tree, so the row says that instead.
  */
  const topLabel = file.parentKind === undefined ? `The top of ${folderName}` : 'None — under none of these'
  const ready = !!folder && (!nests || !!parent)

  async function move() {
    if (!ready || moving) return
    setMoving(true)
    const ok = await onMove(nests ? { folder, parent: parent === TOP ? '' : parent } : { folder })
    setMoving(false)
    if (ok) onClose()
  }

  return (
    <DialogShell
      title="Move"
      onClose={onClose}
      footer={
        <>
          <Button variant="muted" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={!ready || moving}>
            {moving ? 'Moving…' : 'Move'}
          </Button>
        </>
      }
    >
      {destinations.length === 0 ? (
        <EmptyState scope="section" message="There is no other folder it can be moved to." />
      ) : (
        // The package Form (UIG-7): Ctrl+Enter or Move sends; the list picks with Enter.
        <Form id={formId} busy={moving} onSubmit={move}>
          {/* The title and its sentence are one block, 8px apart; the Form puts 24px between it and the fields. */}
          <div className="flex flex-col gap-2">
            <p className="text-body-2-strong text-text-primary">{title}</p>
            <p className="text-body-2 text-text-secondary">Everyone who can read it now still can.</p>
          </div>
          <Field label="Folder">
            <Select
              value={folder}
              onChange={chooseFolder}
              options={destinations.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
              placeholder="Pick a folder"
              ariaLabel="Folder"
            />
          </Field>
          {nests &&
            folder &&
            (status === 'failed' ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-body-2 text-text-secondary">{folderName} could not be read.</p>
                <Button variant="muted" onClick={() => readTargets(folder)}>
                  Try again
                </Button>
              </div>
            ) : status !== 'reading' && status !== undefined && targets.length === 0 ? (
              <EmptyState scope="section" message={`There is nowhere in ${folderName} to put it.`} />
            ) : (
              <Field label="Put it under">
                <Select
                  value={parent ?? ''}
                  onChange={setPicked}
                  options={targets.map((target) => ({
                    value: valueOf(target),
                    label: target.file ? target.path.join(' › ') : topLabel,
                  }))}
                  placeholder={Array.isArray(status) ? 'Pick where it goes' : 'Reading…'}
                  disabled={!Array.isArray(status)}
                  ariaLabel="Put it under"
                />
              </Field>
            ))}
        </Form>
      )}
    </DialogShell>
  )
}
