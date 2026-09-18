import { useId, useState } from 'react'
import { IconLock } from '@tabler/icons-react'
import { Form } from '@estiva-app/ui'
import { Button } from './ui/Button'
import { DialogShell } from './ui/DialogShell'
import { Field } from './ui/Field'
import { TextInput } from './ui/TextInput'
import { PersonChipInput } from './ui/PersonChipInput'
import type { Person } from '@/api'

export interface StartTopicResult {
  title: string
  invitees: Person[]
}

interface CreateTopicDialogProps {
  defaultTitle?: string
  defaultInvitees?: Person[]
  /** When set, the dialog renders the DM-to-huddle privacy banner. */
  dmContext?: { participants: Person[] }
  /** Label for the confirm button. Defaults to "Start topic". */
  confirmLabel?: string
  onConfirm: (data: StartTopicResult) => void
  onCancel: () => void
}

/**
 * The Start topic dialog: a title and people to invite, with a privacy note
 * when a direct message is being turned into a private huddle.
 */
export function CreateTopicDialog({
  defaultTitle = '',
  defaultInvitees = [],
  dmContext,
  confirmLabel = 'Start topic',
  onConfirm,
  onCancel,
}: CreateTopicDialogProps) {
  const [title, setTitle] = useState(defaultTitle)
  const [invitees, setInvitees] = useState<Person[]>(defaultInvitees)

  const canConfirm = title.trim().length > 0
  const formId = useId()

  return (
    <DialogShell
      title="Start topic"
      onClose={onCancel}
      footer={
        <>
          <Button variant="muted" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!canConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {/* The package Form (UIG-7): Enter in the title, Ctrl+Enter anywhere, or the footer's button. */}
      <Form id={formId} onSubmit={() => { if (canConfirm) onConfirm({ title, invitees }) }} className="flex flex-col gap-6">
      <Field label="Title" required>
        <TextInput
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What's this topic about?"
        />
      </Field>

      <Field label="Invite people">
        <PersonChipInput
          value={invitees}
          onChange={setInvitees}
          placeholder="Search people..."
        />
      </Field>

      {dmContext && (
        <div className="flex items-start gap-2 border border-warning-default rounded-lg px-3 py-2.5">
          <IconLock size={16} stroke={1.5} className="text-text-primary shrink-0 mt-0.5" />
          <p className="text-body-2 text-text-primary">
            This DM becomes a private huddle inside the new topic. Only you and the other DM participants can see it — the topic itself is public.
          </p>
        </div>
      )}
      </Form>
    </DialogShell>
  )
}
