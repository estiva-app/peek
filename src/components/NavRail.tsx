import {
  IconNote,
  IconMessage2,
  IconUsers,
  // IconBrackets,
  // IconFiles,
} from '@tabler/icons-react'
import { NavItem } from './NavItem'
import { FreshnessIndicator } from './FreshnessIndicator'
import { useLastSelection } from '@/lib/lastSelection'

export function NavRail() {
  const { topicId, dmId } = useLastSelection()

  const navItems = [
    { to: '/desk', icon: <IconNote size={16} stroke={1.5} />, label: 'Desk', match: '/desk' },
    {
      to: topicId ? `/topics/${topicId}` : '/topics',
      icon: <IconMessage2 size={16} stroke={1.5} />,
      label: 'Topics',
      match: '/topics',
    },
    {
      to: dmId != null ? `/people/${dmId}` : '/people',
      icon: <IconUsers size={16} stroke={1.5} />,
      label: 'People',
      match: '/people',
    },
  ]

  return (
    <nav className="w-16 flex flex-col gap-2 items-start px-2 py-3 shrink-0">
      {navItems.map((item) => (
        <NavItem key={item.label} {...item} />
      ))}
      {/* Once, in the persistent chrome — see FreshnessIndicator's header for
          why this is not a badge per panel and not part of AuthGate. */}
      <FreshnessIndicator />
    </nav>
  )
}
