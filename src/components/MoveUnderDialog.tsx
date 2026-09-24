import { useId, useState } from 'react'
import { Form } from '@estiva-app/ui'
import type { ForeignObject } from '@estiva-app/interop'
import { EmptyState } from '@/components/ui/EmptyState'
import { DialogShell } from './ui/DialogShell'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Field } from './ui/Field'

/** The `Select` value for "the top of the team"; a `parent` change writes it as `''`. */
const TOP = '__top__'

/** One place a file may go: a file in the same team, named by its path, or the top. */
export interface MoveTarget {
  /** Absent for the top of the team. */
  file?: ForeignObject
  /** The target's breadcrumb, outermost first, ending in the target's own title. */
  path: string[]
}

/**
 * Move a file under another file in its team, or back to the top (FOL-4).
 *
 * Not `MoveFileDialog`, which moves a file between *teams* — a different
 * write (`kind:1852`) and a different question, since that one changes who can
 * read it. This one changes only where it is drawn: a `parent` change, and the
 * file's `h` stays where it is (SPEC §6.7). The sentence under the title says
 * so, because "move" in a permissions-shaped product reads as "share".
 *
 * **Targets are the caller's, already filtered.** `nestingOf(...).moveTargetsOf`
 * leaves out the file itself, everything under it (a cycle) and where it is
 * now (no effect) — so every option here can succeed, the app's rule.
 *
 * **Each option is its path**, "Launch › Naming › Transcripts", because two
 * sub-topics called "Notes" under different parents are otherwise the same row.
 */
export function MoveUnderDialog({
  file,
  teamName,
  targets,
  onMove,
  onClose,
}: {
  file: ForeignObject
  /** The team the file is in and stays in. */
  teamName: string
  targets: MoveTarget[]
  /** `parent` is the new parent's address, or `''` for the top. Resolves false to stay open. */
  onMove: (parent: string) => Promise<boolean>
  onClose: () => void
}) {
  const valueOf = (target: MoveTarget) => target.file?.address ?? TOP
  const [to, setTo] = useState(targets[0] ? valueOf(targets[0]) : '')
  const [moving, setMoving] = useState(false)
  const formId = useId()
  const title = file.slots.title?.value ?? 'this file'

  async function move() {
    if (!to || moving) return
    setMoving(true)
    const ok = await onMove(to === TOP ? '' : to)
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
          <Button variant="primary" type="submit" form={formId} disabled={!to || moving}>
            {moving ? 'Moving…' : 'Move'}
          </Button>
        </>
      }
    >
      {targets.length === 0 ? (
        <EmptyState scope="section" message={`There is nowhere else in ${teamName} to put it.`} />
      ) : (
        <Form id={formId} busy={moving} onSubmit={move} className="flex flex-col gap-2">
          <p className="text-body-2-strong text-text-primary">{title}</p>
          <p className="text-body-2 text-text-secondary">
            It stays in {teamName}, and everyone who can read it now still can.
          </p>
          <Field label="Put it under">
            <Select
              value={to}
              onChange={setTo}
              options={targets.map((target) => ({
                value: valueOf(target),
                label: target.file ? target.path.join(' › ') : `The top of ${teamName}`,
              }))}
              ariaLabel="Put it under"
            />
          </Field>
        </Form>
      )}
    </DialogShell>
  )
}
