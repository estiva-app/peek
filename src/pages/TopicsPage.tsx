import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { EmptyState } from '@estiva-app/ui'
import { PeekFrame } from '@/layouts/PeekFrame'
import { TopicsColumn } from '@/components/views/TopicsColumn'
import { ExploreTopics } from '@/components/views/ExploreTopics'
import { useFileControls } from '@/components/views/useFileControls'
import { useLastSelection } from '@/lib/lastSelection'
import { useTabTitle } from '@/lib/useTabTitle'
import { filePath } from '@/lib/objectUrl'

/**
 * `/app/topics` — Peek's Topics screen with no file open (TOP-4): your topics,
 * then Explore topics. A row opens its file on the file page, with this column
 * beside it. `/app/topics/explore` (`explore`) opens Explore topics beside the
 * column (TOPI-6): every topic you can read, archived ones too, to find, join
 * or open.
 */
export function TopicsPage({ explore = false }: { explore?: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  // Where Topics is, for the rail to come back to (Katerina, 5 October): here, with no file open.
  const { setLastTopicsPath } = useLastSelection()
  useEffect(() => {
    setLastTopicsPath(`${location.pathname}${location.search}`)
  }, [location.pathname, location.search, setLastTopicsPath])
  useTabTitle(explore ? 'Explore topics' : 'Topics')
  // A row's menu, the file page's own (FOL-45): Join, Leave, Rename… from either page; Explore's Join too.
  const fileControls = useFileControls({
    onStarted: (created) => navigate(filePath(created.address, created.title), { state: { column: 'topics' } }),
  })
  return (
    <>
      <PeekFrame
        leftPanel={<TopicsColumn exploring={explore} onControl={fileControls.open} />}
        rightPanel={explore ? <ExploreTopics onControl={fileControls.open} /> : <EmptyState message="No file selected" />}
      />
      {fileControls.dialogs}
    </>
  )
}
