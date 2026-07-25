import { useState } from 'react'
import { DialogShell } from './ui/DialogShell'
import { Button } from './ui/Button'
import { Checkbox } from './ui/Checkbox'
import { TopicState } from './ui/TopicState'
import { useTopics, useIsTopicResolved, useOpenWorkTopicIds } from '@/api'
import { cn } from '@/lib/utils'

interface AddToOpenWorkDialogProps {
  /** Called with the selected topic ids. The dialog closes itself via onClose. */
  onAdd: (topicIds: string[]) => void
  onClose: () => void
}

/**
 * The Desk's "+" picker: multi-select topics into Open work. Only topics NOT
 * already there are offered (the action can always succeed); unresolved
 * topics list first. Rows toggle on click anywhere; the checkbox mirrors.
 */
export function AddToOpenWorkDialog({ onAdd, onClose }: AddToOpenWorkDialogProps) {
  const topics = useTopics()
  const isTopicResolved = useIsTopicResolved()
  const inOpenWork = useOpenWorkTopicIds()
  const [selected, setSelected] = useState<Set<string>>(new Set())

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
      // pl-4 evens out the shell's asymmetric pl-5/pr-4 so the row hover pill
      // sits 16px from BOTH dialog edges.
      bodyClassName="flex flex-col gap-0.5 max-h-[360px] overflow-y-auto pl-4"
      footer={
        <>
          <Button variant="muted" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={selected.size === 0} onClick={handleAdd}>
            {selected.size > 1 ? `Add ${selected.size} topics` : 'Add topic'}
          </Button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <p className="text-sm text-text-secondary leading-[1.4] py-1">
          Every topic is already in your Open work.
        </p>
      ) : (
        candidates.map((t) => {
          const checked = selected.has(t.id)
          return (
            <div
              key={t.id}
              role="option"
              aria-selected={checked}
              className={cn(
                'flex items-center gap-3 h-10 px-3 rounded-lg cursor-pointer transition-colors hover:bg-bg-hover',
                checked && 'bg-bg-selected',
              )}
              onClick={() => toggle(t.id)}
            >
              <TopicState type="topic" status={isTopicResolved(t.id) ? 'resolved' : 'unresolved'} />
              <span className="flex-1 min-w-0 text-[14px] font-normal leading-[1.4] text-text-primary truncate">
                {t.title}
              </span>
              <Checkbox checked={checked} aria-label={`Select ${t.title}`} />
            </div>
          )
        })
      )}
    </DialogShell>
  )
}
