import { useState } from 'react'
import { DialogShell } from '@estiva-app/ui'
import { Button } from './ui/Button'
import { PersonChipInput } from './ui/PersonChipInput'
import type { Person } from '@/api'

export interface StartHuddleResult {
  invitees: Person[]
}

interface StartHuddleDialogProps {
  onConfirm: (data: StartHuddleResult) => void
  onCancel: () => void
}

/**
 * V2 huddle creation entry point. Members-only — no title, no first message.
 * The new huddle is empty at creation; the user lands inside it and writes
 * their first message via the huddle's compose box.
 *
 * On the shared DialogShell (2026-09-01) — this dialog's hand-rolled shell
 * was DialogShell's own markup line for line, minus the one thing the shared
 * one adds: Escape closes it.
 */
export function StartHuddleDialog({ onConfirm, onCancel }: StartHuddleDialogProps) {
  const [invitees, setInvitees] = useState<Person[]>([])

  const canConfirm = invitees.length > 0

  return (
    <DialogShell
      title="Start huddle"
      onClose={onCancel}
      bodyClassName="flex flex-col gap-6 overflow-y-auto"
      footer={
        <>
          <Button variant="muted" onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canConfirm}
            onClick={() => canConfirm && onConfirm({ invitees })}
          >
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <label className="text-input-label text-text-primary flex items-center">
          Invite people
          <span className="text-error-default ml-0.5">*</span>
        </label>
        <PersonChipInput
          value={invitees}
          onChange={setInvitees}
          placeholder="Search people..."
        />
      </div>
    </DialogShell>
  )
}
