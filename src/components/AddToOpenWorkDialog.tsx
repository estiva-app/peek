import { useId, useState } from 'react'
import { Form } from '@estiva-app/ui'
import { DialogShell } from './ui/DialogShell'
import { Button } from './ui/Button'
import { Checkbox } from './ui/Checkbox'
import { TopicState } from './ui/TopicState'
import { useTopics, useIsTopicResolved, useOpenWorkTopicIds } from '@/api'

interface AddToOpenWorkDialogProps {
  /** Called with the selected topic ids. The dialog closes itself via onClose. */
  onAdd: (topicIds: string[]) => void
  onClose: () => void
}

/**
 * The Desk's "+" picker: multi-select topics into Open work. Only topics NOT
 * already there are offered (the action can always succeed); unresolved
 * topics list first. Each row is the package Checkbox's row: a click anywhere
 * on it toggles, and Tab and Space reach it from the keyboard.
 */
export function AddToOpenWorkDialog({ onAdd, onClose }: AddToOpenWorkDialogProps) {
  const topics = useTopics()
  const isTopicResolved = useIsTopicResolved()
  const inOpenWork = useOpenWorkTopicIds()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const formId = useId()

  const candidates = (topics ?? [])
    .filter((t) => !inOpenWork.has(t.id))
    .sort((a, b) => Number(isTopicResolved(a.id)) - Number(isTopicResolved(b.id)))

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleAdd = () => {
    onAdd([...selected])
    onClose()
  }

  return (
    <DialogShell
      title="Add to Open work"
      onClose={onClose}
      // Launcher-style row chrome: the body keeps only 8px so the hover pill
      // bleeds near the dialog edges, while the rows' own px-3 lands the
      // content at 20px — aligned with the shell's header title.
      bodyMaxHeight="max-h-[360px]"
      bodyClassName="flex flex-col gap-0.5 px-2"
      footer={
        <>
          <Button variant="muted" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId} disabled={selected.size === 0}>
            {selected.size > 1 ? `Add ${selected.size} topics` : 'Add topic'}
          </Button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <p className="text-body-2 text-text-secondary py-1">
          Every topic is already in your Open work.
        </p>
      ) : (
        // The package Form (UIG-7), the body's own column inside it; Add sends it.
        <Form id={formId} onSubmit={() => { if (selected.size > 0) handleAdd() }} className="flex flex-col gap-0.5">
        {candidates.map((t) => (
          // The package Checkbox's row (UIG-8, Katerina's pick B): the same pixels
          // the hand-made row drew, as a tick box that names itself by its title.
          <Checkbox
            key={t.id}
            row
            leading={<TopicState type="topic" status={isTopicResolved(t.id) ? 'resolved' : 'unresolved'} />}
            label={t.title}
            checked={selected.has(t.id)}
            onChange={() => toggle(t.id)}
          />
        ))}
        </Form>
      )}
    </DialogShell>
  )
}
