import { useNavigate } from 'react-router-dom'
import { Link, type LinkProps } from '@estiva-app/ui'

/**
 * The package's Link, followed through Peek's router — UIG-27.
 *
 * It replaces react-router's `Link` where Peek had one, and keeps what that
 * did: the caller's `onClick` runs first and may take the click
 * (`preventDefault`); otherwise a plain left click navigates in place, the way
 * `NavItem` does, and a modified click, or one with a target, is the browser's —
 * so a new tab still works.
 *
 * The router is read here, in the link, not in the card that draws it: a card
 * rendered without a router (a story, a panel) must still render, as it did
 * when only react-router's Link needed one.
 */
export function RouterLink({ href, onClick, ...props }: LinkProps) {
  const navigate = useNavigate()
  return (
    <Link
      href={href}
      {...props}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        if (props.target && props.target !== '_self') return
        event.preventDefault()
        navigate(href)
      }}
    />
  )
}
