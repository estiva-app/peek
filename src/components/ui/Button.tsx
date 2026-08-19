import { cn } from '@/lib/utils'
import { type ButtonHTMLAttributes, type ReactNode } from 'react'

type ButtonVariant = 'primary' | 'outlined' | 'muted'
type ButtonSize = 'default' | 'small'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  leadingIcon?: ReactNode
  children: ReactNode
}

export function Button({
  variant = 'muted',
  size = 'default',
  leadingIcon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const hasLeadingIcon = !!leadingIcon
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-md transition-colors font-sans font-medium',
        size === 'default' && 'h-8 text-[14px] leading-[14px]',
        size === 'small'   && 'h-6 text-[12px] leading-[12px]',
        // Padding: extra right padding when there's a leading icon for visual balance
        size === 'default' && (hasLeadingIcon ? 'pl-2 pr-3' : 'px-2'),
        // 6px, not 4px (2026-08-19): 4px was set against short labels like
        // "Later" and left anything longer nearly touching its own border.
        // The leading-icon variant keeps the extra right padding above.
        size === 'small'   && (hasLeadingIcon ? 'pl-1.5 pr-2' : 'px-1.5'),
        // Active variants
        !disabled && variant === 'primary'  && 'bg-accent-primary hover:bg-accent-hover text-accent-muted cursor-pointer signal:text-[color:var(--text-inverse)] signal:font-semibold',
        !disabled && variant === 'outlined' && 'border border-border-default hover:bg-bg-hover text-text-primary cursor-pointer',
        !disabled && variant === 'muted'    && 'hover:bg-bg-hover text-text-primary cursor-pointer',
        // Disabled - shared base; outlined keeps its border
        disabled && 'bg-bg-disabled text-text-disabled pointer-events-none',
        disabled && variant === 'outlined' && 'border border-border-default',
        className
      )}
      disabled={disabled}
      {...props}
    >
      {leadingIcon}
      {children}
    </button>
  )
}
