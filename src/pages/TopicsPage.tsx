import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { EmptyState } from '@estiva-app/ui'
import { PeekFrame } from '@/layouts/PeekFrame'
import { TopicsColumn } from '@/components/views/TopicsColumn'
import { useFileControls } from '@/components/views/useFileControls'
import { useLastSelection } from '@/lib/lastSelection'
import { filePath } from '@/lib/objectUrl'
import { useTabTitle } from '@/lib/useTabTitle'

/**
 * `/app/topics` — Peek's Topics screen with no file open (TOP-4): your topics
 * with their files under them, and the other topics to join. A row opens its
 * file on the file page, with this column beside it.
 */
export function TopicsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  // Where Topics is, for the rail to come back to (Katerina, 5 October): here, with no file open.
  const { setLastTopicsPath } = useLastSelection()
  useEffect(() => {
    setLastTopicsPath(`${location.pathname}${location.search}`)
  }, [location.pathname, location.search, setLastTopicsPath])
  useTabTitle('Topics')
  // A row's menu, the file page's own (FOL-45): Join, Leave, Rename… from either page.
  const fileControls = useFileControls({
    onStarted: (created) => navigate(filePath(created.address, created.title), { state: { column: 'topics' } }),
  })
  return (
    <>
      <PeekFrame leftPanel={<TopicsColumn onControl={fileControls.open} />} rightPanel={<EmptyState message="No file selected" />} />
      {fileControls.dialogs}
    </>
  )
}
