import {
  IconMessage,
  IconNote,
  IconUsers,
  // IconBrackets,
  // IconFiles,
} from '@tabler/icons-react'
import { KindIcon, Rail, RailItem, isPlainClick } from '@estiva-app/ui'
import { FreshnessIndicator } from './FreshnessIndicator'
import { useLocation, useNavigate } from 'react-router-dom'
import type { MouseEvent } from 'react'
import type { ListColumnName } from '@/lib/openedFrom'
import { useLastSelection } from '@/lib/lastSelection'
import { fileRouteFromPath } from '@/lib/objectUrl'

/**
 * The narrow bar down the left edge that moves between Desk, Initiatives, Teams
 * and DMs, with a small dot saying whether what is shown is current. The four
 * names are the navigation prototype's (Katerina, 16 November): Topics became
 * Initiatives and People became DMs; the Desk keeps its name for now.
 */
export function NavRail() {
  const { dmId, topicsPath, foldersPath, fileColumn, desk } = useLastSelection()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  /*
    Initiatives and Teams each go back to the page they last showed, in their own
    column: a file can be shown under either, so the address alone could open it
    under the other section, or be the address already open and do nothing
    ("Teams isn't clickable anymore" after Topics, Katerina, 15 November). The
    column rides in the history entry, as a row's click hands it (TOP-4).
  */
  const inColumn = (to: string, column: ListColumnName) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return
    event.preventDefault()
    navigate(to, { state: { column } })
  }
  /*
    A file's page, at `/topic/…` or whatever word its manifest declared
    (FOL-39), is read under Initiatives or under Teams: the column it shows,
    which is decided by what the file is (an initiative, or anything that
    lives in a team; Katerina, 16 November). Neither is lit until that is known.
  */
  const openFile = pathname.startsWith('/topic/') || !!fileRouteFromPath(pathname)
  const fileIn = (column: 'topics' | 'folders') => openFile && fileColumn === column

  const navItems = [
    // Back to what Desk had open: a file beside the lists is in its query; a DM the page restores (Katerina, 5 October).
    { to: `/app/desk${desk?.search ?? ''}`, icon: <IconNote size={16} stroke={1.5} />, label: 'Desk', active: isAt(pathname, '/app/desk') },
    {
      // Your initiatives (TOP-4's Topics, renamed 16 November), the Per app prototype's target icon.
      // Back to where it was — an initiative, or none open — as DMs goes back to the last DM (Katerina, 5 October; kept 16 November).
      to: topicsPath ?? '/app/initiatives',
      // ◎ from the kit's KindIcon, the one part that names an initiative (review of 23 November, C7).
      icon: <KindIcon kind="topic" tone="inherit" />,
      label: 'Initiatives',
      active: isAt(pathname, '/app/initiatives') || fileIn('topics'),
      onClick: topicsPath ? inColumn(topicsPath, 'topics') : undefined,
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
      onClick: foldersPath ? inColumn(foldersPath, 'folders') : undefined,
    },
    {
      to: dmId != null ? `/app/dms/${dmId}` : '/app/dms',
      // A speech bubble (Katerina, 16 November): one person beside Teams' people read alike.
      icon: <IconMessage size={16} stroke={1.5} />,
      label: 'DMs',
      active: isAt(pathname, '/app/dms'),
    },
  ]

  return (
    <Rail>
      {navItems.map(({ to, icon, label, active, onClick }) => (
        // The click goes through Peek's router by itself (`AppProvider`, PeekSetup), or by `onClick` with the column.
        <RailItem key={label} href={to} icon={icon} label={label} active={active} {...(onClick ? { onClick } : {})} />
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
