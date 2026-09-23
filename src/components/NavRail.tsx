import {
  IconNote,
  IconUsers,
  IconFolder,
  // IconBrackets,
  // IconFiles,
} from '@tabler/icons-react'
import { Rail } from '@estiva-app/ui'
import { NavItem } from './NavItem'
import { FreshnessIndicator } from './FreshnessIndicator'
import { useLocation } from 'react-router-dom'
import { useLastSelection } from '@/lib/lastSelection'
import { fileRouteFromPath } from '@/lib/objectUrl'

/**
 * The narrow bar down the left edge that moves between Desk, Topics and
 * People, with a small dot saying whether what is shown is current.
 */
export function NavRail() {
  const { dmId } = useLastSelection()
  const { pathname } = useLocation()
  // A file's page, at whatever word its manifest declared (FOL-39), is read
  // under Topics — where `/topic/<address>` always was.
  const openFile = fileRouteFromPath(pathname)

  const navItems = [
    { to: '/app/desk', icon: <IconNote size={16} stroke={1.5} />, label: 'Desk', match: '/app/desk' },
    {
      to: '/app/folders',
      icon: <IconFolder size={16} stroke={1.5} />,
      /*
        "Topics", not "Folders" (Miky, FOL-41). The route, the page and the
        tree are unchanged: this rail item is what a person is told the section
        *is*, and what it is is the topic list — a Folder is how it is
        organised, not what it holds. It was "Topics (new)" beside the Convex
        Topics view until FOL-26 retired that one.
      */
      label: 'Topics',
      // `/app/folders` is the list and `/app/folders/<uuid>` one of them; a
      // file opens at `/topic/` or at the word its app declared (FOL-39). No
      // last-selection memory, unlike People — a Folder list is short and a
      // remembered one would be a guess about which of several containers
      // somebody meant.
      match: ['/app/folders', '/topic', ...(openFile ? [`/${openFile.word}`] : [])],
    },
    {
      to: dmId != null ? `/app/people/${dmId}` : '/app/people',
      icon: <IconUsers size={16} stroke={1.5} />,
      label: 'People',
      match: '/app/people',
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
