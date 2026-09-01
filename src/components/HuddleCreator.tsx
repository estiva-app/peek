import { useState, useRef, useEffect } from 'react'
import { IconX } from '@tabler/icons-react'
import { MenuItem } from '@estiva-app/ui'
import { Avatar } from './ui/Avatar'
import { ComposeBox, type SendPayload } from './ui/ComposeBox'
import { usePeople } from '@/api'
import { cn } from '@/lib/utils'

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
  const inputRef = useRef<HTMLInputElement>(null)
  const [recipients, setRecipients] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [suggestionIndex, setSuggestionIndex] = useState(0)

  // Ref so the once-mounted outside-click/Escape listener always sees the latest onCancel.
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  const addRecipient = (name: string) => {
    if (!recipients.includes(name)) setRecipients((prev) => [...prev, name])
    setQuery('')
    setSuggestionIndex(0)
    // Re-focus the To: input so the user can keep typing more people without re-clicking.
    setTimeout(() => inputRef.current?.focus(), 0)
  }
  const removeRecipient = (name: string) => setRecipients((prev) => prev.filter((n) => n !== name))

  const people = usePeople() ?? []
  const suggestions = people.filter(
    (p) => !recipients.includes(p.name) && p.name.toLowerCase().includes(query.toLowerCase())
  )

  // Keep the To: input focused whenever the recipient list changes.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [recipients.length])

  // Close on outside click or Escape.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
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
    if (text) onCreate(recipients, text)
  }

  return (
    <div ref={rootRef} className="shrink-0 px-3 pb-3 flex flex-col gap-0">
      <div className="relative">
        <div className="flex items-center gap-2 px-3 py-2 bg-bg-elevated border border-border-default rounded-t-lg">
          <span className="text-caption text-text-muted shrink-0">To:</span>
          <div className="flex-1 flex items-center gap-1 flex-wrap min-h-[24px]">
            {recipients.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-accent-muted text-text-primary text-sm rounded-sm"
              >
                {name}
                <button
                  onClick={() => removeRecipient(name)}
                  className="text-text-muted hover:text-text-primary cursor-pointer"
                >
                  <IconX size={12} stroke={1.5} />
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                // Reset highlight when the query changes — list contents are now different.
                setSuggestionIndex(0)
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => {
                // Only mark unfocused if the input genuinely lost focus. Without
                // this guard, briefly stealing focus on click + immediately refocusing
                // would still trigger setFocused(false) 150ms later, closing the dropdown.
                if (document.activeElement !== inputRef.current) {
                  setFocused(false)
                }
              }, 150)}
              onKeyDown={(e) => {
                if (suggestions.length === 0) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSuggestionIndex((i) => (i + 1) % suggestions.length)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSuggestionIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
                } else if (e.key === 'Enter') {
                  const pick = suggestions[suggestionIndex]
                  if (pick) {
                    e.preventDefault()
                    addRecipient(pick.name)
                  }
                }
              }}
              placeholder={recipients.length === 0 ? 'Add people...' : 'Add more...'}
              autoFocus
              className="flex-1 min-w-[80px] bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
            />
          </div>
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 text-caption text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            Cancel
            <kbd className="inline-flex items-center justify-center bg-bg-inset border border-border-strong rounded-sm px-1 py-[1px] text-caption text-text-secondary shrink-0">
              ESC
            </kbd>
          </button>
        </div>
        {focused && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 bottom-full mb-1 bg-bg-elevated border border-border-default rounded-lg shadow-md py-1 max-h-[200px] overflow-y-auto z-50">
            {suggestions.map((person, i) => (
              <MenuItem
                key={person.id}
                className="rounded-none gap-2 px-3"
                selected={i === suggestionIndex}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setSuggestionIndex(i)}
                onClick={() => addRecipient(person.name)}
              >
                <Avatar size={24} name={person.name} alt={person.name} />
                <div className="flex flex-col items-start">
                  <span className="text-sm text-text-primary">{person.name}</span>
                  <span className="text-caption text-text-muted">{person.role}</span>
                </div>
              </MenuItem>
            ))}
          </div>
        )}
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
