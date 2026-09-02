import { useLocation, useNavigate } from 'react-router-dom'
import { type ReactNode, type MouseEvent } from 'react'
import { RailItem } from '@estiva-app/ui'

/**
 * Peek's rail entry: the shared RailItem, with the route-matching that a
 * shared component cannot know (2026-09-02). The tile and its label moved
 * to the package; what stayed here is which routes light it up, and the
 * router navigation.
 */
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
  const navigate = useNavigate()
  const matchPrefixes = match === undefined ? [to] : Array.isArray(match) ? match : [match]
  const isActive = matchPrefixes.some(
    (prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`),
  )

  return (
    <RailItem
      href={to}
      icon={icon}
      label={label}
      active={isActive}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        // A plain left click navigates in place; modified clicks keep the
        // browser's open-in-new-tab behaviour, as the router link allowed.
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(to)
      }}
    />
  )
}
