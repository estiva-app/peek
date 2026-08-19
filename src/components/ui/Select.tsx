import { IconCheck, IconChevronDown } from '@tabler/icons-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/**
 * A select Peek draws itself.
 *
 * The native control cannot be styled where it matters: its option list is
 * rendered by the operating system, so it arrives in the system font at the
 * system size with the system highlight colour — beside inputs that are none of
 * those things, and beside four menus in this app that all share one shape.
 *
 * So the trigger is `TextInput`'s field, and the menu is Peek's menu — the one
 * `TopicMenu`, `FilesMenu` and `ScreenerLaterMenu` already use: floating, 8px
 * radius, soft shadow, 36px rows that fill on hover.
 *
 * Replacing a native control means re-implementing what it gave away for free,
 * so the keyboard is not an afterthought: arrows move, Home and End jump, Enter
 * and Space pick, Escape closes and returns focus to the trigger, and the active
 * option is announced through `aria-activedescendant` rather than by moving
 * focus into the list. Type-ahead is the one native behaviour not reproduced.
 */
export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  /**
   * `default` matches `TextInput`, for a select sitting in a `Field`.
   *
   * `small` matches `Button`'s small size, for dense surfaces like the Files
   * panel, where a full-height field would dominate a property row.
   */
  size?: 'default' | 'small'
  /** Needed when no visible `Field` label names this control. */
  ariaLabel?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function Select({
  value,
  onChange,
  options,
  size = 'default',
  ariaLabel,
  placeholder = 'Select…',
  disabled,
  className,
}: SelectProps) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const open = rect !== null

  const selectedIndex = useMemo(
    () => Math.max(0, options.findIndex((o) => o.value === value)),
    [options, value],
  )
  const [activeIndex, setActiveIndex] = useState(selectedIndex)

  const close = useCallback((refocus: boolean) => {
    setRect(null)
    if (refocus) triggerRef.current?.focus()
  }, [])

  const openMenu = useCallback(() => {
    setActiveIndex(selectedIndex)
    setRect(triggerRef.current?.getBoundingClientRect() ?? null)
  }, [selectedIndex])

  /**
   * Outside click and Escape — the two exits every menu in Peek has.
   *
   * `mousedown` rather than `click`, so a press that starts outside dismisses
   * without also activating whatever it landed on.
   */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      if (triggerRef.current?.contains(e.target as Node)) return
      setRect(null)
    }
    // A menu pinned to a rectangle has to go when the rectangle moves.
    const onMove = () => setRect(null)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  const pick = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    close(true)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      // Down, Up, Enter and Space all open a closed native select.
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openMenu()
      }
      return
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        close(true)
        break
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => Math.min(options.length - 1, i + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => Math.max(0, i - 1))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        pick(activeIndex)
        break
      case 'Tab':
        close(false)
        break
    }
  }

  const selected = options.find((o) => o.value === value)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          // `TextInput`'s field, so a select inside a `Field` is the same control.
          'flex w-full items-center justify-between gap-2 rounded-lg border bg-bg-inset text-left',
          'border-border-default text-text-primary outline-none transition-colors',
          'hover:border-border-strong disabled:pointer-events-none disabled:bg-bg-disabled disabled:text-text-disabled',
          'focus-visible:border-border-strong aria-expanded:border-border-strong',
          'signal:transition-shadow signal:focus-visible:border-border-focus signal:focus-visible:shadow-[shadow:var(--focus-ring)]',
          size === 'default' && 'px-3 py-2 text-[14px] leading-[1.4] font-normal',
          // `h-6` rather than vertical padding, so a small select and a small
          // `Button` in adjacent property rows line up. Padding alone left the
          // select 3px taller than the button beside it.
          size === 'small' && 'h-6 px-2 text-[12px] leading-[1.4] font-normal',
          className,
        )}
      >
        <span className={cn('truncate', !selected && 'text-text-muted')}>
          {selected?.label ?? placeholder}
        </span>
        <IconChevronDown
          size={size === 'small' ? 14 : 16}
          stroke={1.5}
          className="shrink-0 text-text-secondary"
        />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-activedescendant={`${id}-${activeIndex}`}
            tabIndex={-1}
            style={{ top: rect.bottom + 4, left: rect.left, minWidth: rect.width }}
            className="fixed z-50 max-h-72 overflow-y-auto rounded-lg border border-border-default bg-bg-elevated p-1 shadow-lg"
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => {
                  // The document-level dismiss also listens on mousedown.
                  e.preventDefault()
                  pick(index)
                }}
                className={cn(
                  'flex h-9 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 transition-colors',
                  'text-[14px] font-normal leading-[1.4] text-text-primary',
                  // One highlight, driven by the keyboard. The pointer sets it on
                  // enter, so a hover and a keyboard cursor are never both lit.
                  index === activeIndex && 'bg-bg-hover',
                  option.value === value && 'font-medium',
                )}
              >
                <span className="truncate">{option.label}</span>
                {option.value === value && (
                  <IconCheck size={16} stroke={1.5} className="shrink-0 text-text-secondary" />
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
