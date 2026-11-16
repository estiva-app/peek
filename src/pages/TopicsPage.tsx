import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { EmptyState } from '@estiva-app/ui'
import { PeekFrame } from '@/layouts/PeekFrame'
import { EXPLORE_TOPICS_PATH, TopicsColumn } from '@/components/views/TopicsColumn'
import { ExploreTopics } from '@/components/views/ExploreTopics'
import { useFileControls } from '@/components/views/useFileControls'
import { useLastSelection } from '@/lib/lastSelection'
import { useTabTitle } from '@/lib/useTabTitle'
import { useMembership } from '@/api'

/**
 * `/app/initiatives` — Peek's Topics screen with no file open (TOP-4): your topics,
 * then Explore topics. A row opens its file on the file page, with this column
 * beside it. `/app/initiatives/explore` (`explore`) opens Explore topics beside the
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
  useTabTitle(explore ? 'Explore initiatives' : 'Initiatives')
  // A row's menu, the file page's own (FOL-45): Join, Leave, Rename… from either page; Explore's Join too.
  const membership = useMembership()
  const fileControls = useFileControls({
    // A Join or Leave moves the topic in the column and between Explore's tabs at once (Miky, 10 Nov): the column reads membership changes.
    onMembership: () => void membership.refresh(),
  })
  return (
    <>
      <PeekFrame
        leftPanel={<TopicsColumn exploring={explore} onControl={fileControls.open} />}
        rightPanel={
          explore ? (
            <ExploreTopics onControl={fileControls.open} />
          ) : (
            // Nothing opens by itself (Q-47). The prototype's line, and a button that does what it says (Katerina, 16 November, Q-48).
            <EmptyState
              scope="page"
              message="Initiatives you are in show here. Explore initiatives to find one."
              action={{ label: 'Explore initiatives', onClick: () => navigate(EXPLORE_TOPICS_PATH) }}
            />
          )
        }
      />
      {fileControls.dialogs}
    </>
  )
}
