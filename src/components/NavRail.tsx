import {
  IconNote,
  IconTarget,
  IconUser,
  IconUsers,
  // IconBrackets,
  // IconFiles,
} from '@tabler/icons-react'
import { Rail, RailItem } from '@estiva-app/ui'
import { FreshnessIndicator } from './FreshnessIndicator'
import { useLocation } from 'react-router-dom'
import { useLastSelection } from '@/lib/lastSelection'
import { fileRouteFromPath } from '@/lib/objectUrl'

/**
 * The narrow bar down the left edge that moves between Desk, Topics, Folders
 * and People, with a small dot saying whether what is shown is current.
 */
export function NavRail() {
  const { dmId, topicsPath, foldersPath, fileColumn, desk } = useLastSelection()
  const { pathname } = useLocation()
  /*
    A file's page, at `/topic/…` or whatever word its manifest declared
    (FOL-39), is read under Topics or under Folders: the column it shows, which
    is the one it was opened from (TOP-4). Neither is lit until that is known.
  */
  const openFile = pathname.startsWith('/topic/') || !!fileRouteFromPath(pathname)
  const fileIn = (column: 'topics' | 'folders') => openFile && fileColumn === column

  const navItems = [
    // Back to what Desk had open: a file beside the lists is in its query; a DM the page restores (Katerina, 5 October).
    { to: `/app/desk${desk?.search ?? ''}`, icon: <IconNote size={16} stroke={1.5} />, label: 'Desk', active: isAt(pathname, '/app/desk') },
    {
      // Your topics with their files under them (TOP-4), the Per app prototype's target icon.
      // Back to where it was — a file, or none open — as People goes back to the last DM (Katerina, 5 October).
      to: topicsPath ?? '/app/topics',
      icon: <IconTarget size={16} stroke={1.5} />,
      label: 'Topics',
      active: isAt(pathname, '/app/topics') || fileIn('topics'),
    },
    {
      /*
        Teams (TEA-5): the teams you are in, the ones you follow and the rest,
        each with its chat, spaces and the topics it leads. "Folders" until
        the Teams stage (Miky, 30 October); the route stays, so every link to
        a Folder opens its team. The memory is the open file's, never a
        team's: a remembered team would be a guess about which one somebody
        meant.
      */
      to: foldersPath ?? '/app/teams',
      icon: <IconUsers size={16} stroke={1.5} />,
      label: 'Teams',
      active: isAt(pathname, '/app/teams') || fileIn('folders'),
    },
    {
      to: dmId != null ? `/app/people/${dmId}` : '/app/people',
      // One person, as the prototype draws People beside a team's icon.
      icon: <IconUser size={16} stroke={1.5} />,
      label: 'People',
      active: isAt(pathname, '/app/people'),
    },
  ]

  return (
    <Rail>
      {navItems.map(({ to, icon, label, active }) => (
        // The click goes through Peek's router by itself (`AppProvider`, PeekSetup).
        <RailItem key={label} href={to} icon={icon} label={label} active={active} />
      ))}
      {/* Once, in the persistent chrome — see FreshnessIndicator's header for
          why this is not a badge per panel and not part of AuthGate. */}
      <FreshnessIndicator />
    </Rail>
  )
}

/** Lit on its own pages. */
function isAt(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}
