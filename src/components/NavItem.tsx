import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { type ReactNode } from 'react'

interface NavItemProps {
  to: string
  icon: ReactNode
  label: string
  /** Path prefix(es) used to determine the active state (defaults to `to`).
   *  A list because one section can own more than one route: object URLs put
   *  the directory at `/topics` and a single topic at `/topic/…` (PEE-14). */
  match?: string | string[]
}

export function NavItem({ to, icon, label, match }: NavItemProps) {
  const location = useLocation()
  const matchPrefixes = match === undefined ? [to] : Array.isArray(match) ? match : [match]
  const isActive = matchPrefixes.some(
    (prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`),
  )

  return (
    <NavLink to={to} className="group flex flex-col gap-0.5 items-center px-2 py-0.5 w-full">
      <>
        <div
          className={cn(
            'flex items-center justify-center p-2 rounded-lg transition-colors',
            isActive ? 'bg-bg-selected' : 'group-hover:bg-bg-hover'
          )}
        >
          <span
            className={cn(
              'flex items-center transition-colors',
              isActive ? 'text-text-primary signal:text-[color:var(--text-interactive)]' : 'text-text-secondary'
            )}
          >
            {icon}
          </span>
        </div>
        <span
          className={cn(
            'text-[9px] font-medium text-center leading-[115%]',
            isActive ? 'text-text-primary' : 'text-text-secondary'
          )}
        >
          {label}
        </span>
      </>
    </NavLink>
  )
}
