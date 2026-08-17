import { IconCheck } from '@tabler/icons-react'
import { cn } from '@/lib/utils'

interface CheckboxProps {
  checked: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  'aria-label'?: string
  className?: string
}

/**
 * Checkbox primitive — a 16px square that fills with the accent when checked.
 * Controlled only; parents own the state. Rendered as a button with the
 * checkbox role so it works standalone or inside clickable rows (callers
 * that toggle on the row click can pass no onChange and mark it inert).
 */
export function Checkbox({ checked, onChange, disabled = false, className, ...aria }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={aria['aria-label']}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange?.(!checked)
      }}
      className={cn(
        'inline-flex items-center justify-center size-4 shrink-0 rounded-[4px] border transition-colors',
        checked
          ? 'bg-accent-primary border-accent-primary text-text-inverse'
          : 'bg-transparent border-border-strong hover:border-text-muted',
        disabled && 'opacity-50 pointer-events-none',
        onChange ? 'cursor-pointer' : 'pointer-events-none',
        className,
      )}
    >
      {checked && <IconCheck size={12} stroke={3} />}
    </button>
  )
}
