import { useState, useRef, useEffect } from 'react'
import { Kbd } from '@estiva-app/ui'
import { ComposeBox, type SendPayload } from './ui/ComposeBox'
import { PersonChipInput } from './ui/PersonChipInput'
import { type Person } from '@/api'

interface HuddleCreatorProps {
  /** Topic the huddle is being started in — drives the compose box's context label. */
  topicTitle?: string
  /** Cancel creation (Cancel button, Escape, or an outside click). */
  onCancel: () => void
  /** Fires when the user sends the first message with at least one recipient. */
  onCreate: (recipients: string[], firstMessage: string) => void
}

/** People-picker + first-message UI for starting a huddle inside a topic. Mounted inline
 *  (V3, above the topic composer) or in the V1 Huddles tab — identical markup in both. Owns
 *  its recipient/query state and closes itself on Escape or an outside click. */
export function HuddleCreator({ topicTitle, onCancel, onCreate }: HuddleCreatorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  /*
   * The recipients are the shared people picker's now (ADOPTION P14, stage 5,
   * 2026-09-13) — the same `PersonChipInput` the Members and New topic dialogs
   * use, on the package's `ChipInput`. This file used to rebuild all of it:
   * its own chips, its own input, its own list with its own arrow keys and
   * Enter, and a blur timeout to keep a click on a row from closing the list.
   * `onCreate` still receives names, so nothing upstream changes.
   */
  const [recipients, setRecipients] = useState<Person[]>([])

  // Ref so the once-mounted outside-click/Escape listener always sees the latest onCancel.
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  // Close on outside click or Escape.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      // The picker's suggestion list is portalled to the body, so a click on a
      // person lands outside this component's box — and must not read as a
      // click away from the huddle.
      if ((e.target as Element | null)?.closest?.('[role="listbox"]')) return
      onCancelRef.current()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelRef.current()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [])

  const handleSend = ({ text }: SendPayload) => {
    if (text) onCreate(recipients.map((p) => p.name), text)
  }

  return (
    <div ref={rootRef} className="shrink-0 px-3 pb-3 flex flex-col gap-0">
      <div className="relative">
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-elevated border border-border-default rounded-t-lg">
          <span className="text-caption text-text-muted shrink-0">To:</span>
          <div className="flex-1 min-w-0">
            <PersonChipInput value={recipients} onChange={setRecipients} placeholder="Add people..." autoFocus />
          </div>
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 text-caption text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            Cancel
            <Kbd>Esc</Kbd>
          </button>
        </div>
      </div>
      {recipients.length === 0 ? (
        // Mirror ComposeBox's outer dimensions (p-3 + min-h-[20px] editor row + gap-4 +
        // h-6 button row) so the section height is identical before and after the first
        // recipient is added — guarantees no jump. The hint text uses V1's caption
        // text-muted styling rather than the editor's body text.
        <div className="border border-t-0 border-border-default rounded-b-lg overflow-hidden">
          <div className="bg-bg-inset border border-border-default rounded-lg p-3 flex flex-col gap-4">
            <div className="min-h-[20px] flex items-center text-caption text-text-muted">
              Add at least one person to start a Huddle
            </div>
            <div className="h-6" />
          </div>
        </div>
      ) : (
        <div className="border border-t-0 border-border-default rounded-b-lg overflow-hidden">
          <ComposeBox onSend={handleSend} placeholder="default" contextLabel={topicTitle ? `New huddle in ${topicTitle}` : undefined} />
        </div>
      )}
    </div>
  )
}
