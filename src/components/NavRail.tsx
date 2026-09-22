import {
  IconNote,
  IconMessage2,
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
import { useTopicPath } from '@/lib/useTopicPath'
import { fileRouteFromPath } from '@/lib/objectUrl'

/**
 * The narrow bar down the left edge that moves between Desk, Topics,
 * Topics (new) and People, with a small dot saying whether what is shown is
 * current.
 */
export function NavRail() {
  const { topicId, dmId } = useLastSelection()
  const pathForTopic = useTopicPath()
  const { pathname } = useLocation()
  // A file's page, at whatever word its manifest declared (FOL-39), is read
  // under Topics — where `/topic/<address>` always was.
  const openFile = fileRouteFromPath(pathname)

  const navItems = [
    { to: '/app/desk', icon: <IconNote size={16} stroke={1.5} />, label: 'Desk', match: '/app/desk' },
    {
      to: topicId ? pathForTopic(topicId) : '/topics',
      icon: <IconMessage2 size={16} stroke={1.5} />,
      label: 'Topics',
      // Every route here belongs to this section: `/topics` is the directory,
      // a single topic lives at `/topic/<slug>-<d>` (PEE-14) — or, for a
      // Convex topic, at `/topic-old/` (FOL-37) — and any other file at the
      // word its app declared.
      match: ['/topics', '/topic', '/topic-old', ...(openFile ? [`/${openFile.word}`] : [])],
    },
    {
      to: '/app/folders',
      icon: <IconFolder size={16} stroke={1.5} />,
      /*
        "Topics (new)", not "Folders" (Miky, FOL-41). The route, the page and
        the tree are unchanged: this rail item is what a person is told the
        section *is*, and what it is is the topic list that replaces the one
        above it — a Folder is how it is organised, not what it holds. Named
        beside the old Topics rather than in place of it, because both are
        reachable while the twenty-five Convex topics still live at
        `/topic-old/` (FOL-37); the "(new)" is what says which is which, and it
        goes when the old one does.
      */
      label: 'Topics (new)',
      // Both routes: `/app/folders` is the list and `/app/folders/<uuid>` is
      // one of them. No last-selection memory, unlike Topics and People — a
      // Folder list is short and a remembered one would be a guess about which
      // of several containers somebody meant.
      match: '/app/folders',
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
