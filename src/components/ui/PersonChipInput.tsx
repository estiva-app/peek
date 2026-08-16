import { useState, useRef, useMemo, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { IconX } from '@tabler/icons-react'
import { Avatar } from './Avatar'
import { usePeople, type Person } from '@/api'
import { cn } from '@/lib/utils'

interface PersonChipInputProps {
  value: Person[]
  onChange: (next: Person[]) => void
  placeholder?: string
  autoFocus?: boolean
  /** Person ids excluded from the suggestion list (e.g., the current user). */
  excludeIds?: string[]
}

export function PersonChipInput({
  value,
  onChange,
  placeholder = 'Search people...',
  autoFocus,
  excludeIds = [],
}: PersonChipInputProps) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [isFocused, setIsFocused] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const people = usePeople() ?? []

  const matches = useMemo(() => {
    const selectedIds = new Set(value.map((p) => p.id))
    const excludedIds = new Set(excludeIds)
    const q = query.trim().toLowerCase()
    return people.filter((p) => {
      if (selectedIds.has(p.id)) return false
      if (excludedIds.has(p.id)) return false
      if (!q) return true
      return p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q)
    })
  }, [query, value, excludeIds, people])

  useEffect(() => {
    setHighlight(0)
  }, [query, matches.length])

  // Suggestions appear only once the user types — focusing (or auto-focus on
  // dialog open) must not drop the full people directory over the dialog.
  const showDropdown = isFocused && query.trim().length > 0 && matches.length > 0

  useLayoutEffect(() => {
    if (!showDropdown) return
    const update = () => {
      if (wrapperRef.current) setAnchorRect(wrapperRef.current.getBoundingClientRect())
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [showDropdown, value.length])

  function addPerson(person: Person) {
    onChange([...value, person])
    setQuery('')
    inputRef.current?.focus()
  }

  function removePerson(personId: string) {
    onChange(value.filter((p) => p.id !== personId))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && query === '' && value.length > 0) {
      removePerson(value[value.length - 1].id)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(0, matches.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const target = matches[highlight]
      if (target) addPerson(target)
      return
    }
    if (e.key === 'Escape') {
      setQuery('')
      ;(e.target as HTMLInputElement).blur()
    }
  }

  return (
    <div className="relative">
      <div
        ref={wrapperRef}
        className="bg-bg-inset border border-border-default focus-within:border-border-strong rounded-lg px-3 py-1.5 flex flex-wrap items-center gap-1.5 transition-colors min-h-[38px] cursor-text signal:transition-shadow signal:focus-within:border-border-focus signal:focus-within:shadow-[shadow:var(--focus-ring)]"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((p) => (
          <div
            key={p.id}
            className="inline-flex items-center gap-1.5 bg-bg-elevated border border-border-subtle rounded-full pl-1 pr-1 py-0.5 max-h-[24px]"
          >
            <Avatar size={16} name={p.name} alt={p.name} className="rounded-full" />
            <span className="text-[12px] leading-[1.2] font-medium text-text-primary">{p.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removePerson(p.id)
              }}
              className="size-4 flex items-center justify-center rounded-full hover:bg-bg-hover text-text-secondary"
              aria-label={`Remove ${p.name}`}
            >
              <IconX size={10} stroke={1.5} />
            </button>
          </div>
        ))}

        <input
          ref={inputRef}
          autoFocus={autoFocus}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setTimeout(() => setIsFocused(false), 150)
          }}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] bg-transparent text-body-2 text-text-primary placeholder:text-text-muted outline-none border-none"
        />
      </div>

      {showDropdown && anchorRect && createPortal(
        <div
          className="fixed z-[60] max-h-[240px] overflow-y-auto bg-bg-elevated border border-border-default rounded-lg shadow-lg"
          style={{
            top: anchorRect.bottom + 4,
            left: anchorRect.left,
            width: anchorRect.width,
          }}
        >
          {matches.map((p, i) => (
            <div
              key={p.id}
              className={cn(
                'flex items-center gap-3 h-12 px-3 py-1.5 cursor-pointer transition-colors',
                i === highlight ? 'bg-bg-hover' : ''
              )}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                addPerson(p)
              }}
            >
              <Avatar size={32} name={p.name} alt={p.name} />
              <div className="flex flex-col flex-1 min-w-0 gap-[2px] justify-center">
                <div className="text-[14px] font-normal leading-[1.4] text-text-primary truncate">{p.name}</div>
                <div className="text-[12px] leading-[1.2] text-text-secondary truncate">{p.role}</div>
              </div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
