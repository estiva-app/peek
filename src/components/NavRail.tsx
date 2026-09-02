import {
  IconNote,
  IconMessage2,
  IconUsers,
  // IconBrackets,
  // IconFiles,
} from '@tabler/icons-react'
import { Rail } from '@estiva-app/ui'
import { NavItem } from './NavItem'
import { FreshnessIndicator } from './FreshnessIndicator'
import { useLastSelection } from '@/lib/lastSelection'
import { useTopicPath } from '@/lib/useTopicPath'

export function NavRail() {
  const { topicId, dmId } = useLastSelection()
  const pathForTopic = useTopicPath()

  const navItems = [
    { to: '/desk', icon: <IconNote size={16} stroke={1.5} />, label: 'Desk', match: '/desk' },
    {
      to: topicId ? pathForTopic(topicId) : '/topics',
      icon: <IconMessage2 size={16} stroke={1.5} />,
      label: 'Topics',
      // Both routes belong to this section: `/topics` is the directory and a
      // single topic lives at `/topic/<slug>-<uuid>` (PEE-14).
      match: ['/topics', '/topic'],
    },
    {
      to: dmId != null ? `/people/${dmId}` : '/people',
      icon: <IconUsers size={16} stroke={1.5} />,
      label: 'People',
      match: '/people',
    },
  ]

  return (
    <Rail>
      {navItems.map((item) => (
        <NavItem key={item.label} {...item} />
      ))}
      {/* Once, in the persistent chrome — see FreshnessIndicator's header for
          why this is not a badge per panel and not part of AuthGate. */}
      <FreshnessIndicator />
    </Rail>
  )
}
