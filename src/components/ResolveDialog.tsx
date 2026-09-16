import { useId, useState } from 'react'
import { Form } from '@estiva-app/ui'
import { Button } from './ui/Button'
import { DialogShell } from './ui/DialogShell'
import { Field } from './ui/Field'
import { Textarea } from './ui/Textarea'

interface ResolveDialogProps {
  onResolve: (message: string) => void
  onCancel: () => void
}

export function ResolveDialog({ onResolve, onCancel }: ResolveDialogProps) {
  const [message, setMessage] = useState('')
  const formId = useId()

  return (
    <DialogShell
      title="Resolve"
      onClose={onCancel}
      footer={
        <>
          <Button variant="muted" onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            // Signal: the v3 resolve button — outlined at rest, green on hover.
            className="signal:bg-transparent signal:border signal:border-border-default signal:text-text-primary signal:shadow-none signal:hover:bg-success-muted signal:hover:border-success-outline signal:hover:text-success-default signal:transition-colors"
          >
            Resolve
          </Button>
        </>
      }
    >
      {/* The package Form (UIG-7): Ctrl+Enter resolves from the message; Enter there is a new line. */}
      <Form id={formId} onSubmit={() => onResolve(message)}>
      <Field label="Resolution message (optional)">
        <Textarea
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Summarize the outcome or decision..."
          className="h-[109px]"
        />
      </Field>
      </Form>
    </DialogShell>
  )
}
