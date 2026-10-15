import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { onTopicRefused, useForeignObjects, type RefusedTopic } from '@/api'
import { browserDrafts, draftKeys } from '@/lib/drafts'
import { filePath } from '@/lib/objectUrl'
import { useToast } from '@/lib/toast'
import { StartTopicDialog } from './StartTopicDialog'

/**
 * A new topic the relay refused (PEE-6; decided by Miky, 12 and 15 October).
 *
 * Start opened the topic before it was written, so a refusal takes it back:
 * the person, if still in it, is back in its Folder; the note says what came
 * back — "title restored", or "title and text restored" when something was
 * typed or sent in it, which is now that topic's draft; and Start's dialog is
 * open again with the title. Starting it again writes the same topic, by the
 * same `d`, so its draft is in the composer when it opens.
 *
 * One for the whole app, because Start is offered from three places — the
 * tree's header, a Folder's menu and a file's "New topic inside" — and the
 * page that offered it may be gone by the time the relay answers.
 */
export function StartedTopicRefusals() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { showToast } = useToast()
  const { createTopic } = useForeignObjects()
  const [again, setAgain] = useState<RefusedTopic | null>(null)

  // Where the person is when the relay answers, not where they were at Start.
  const at = useRef(pathname)
  useEffect(() => {
    at.current = pathname
  }, [pathname])

  useEffect(
    () =>
      onTopicRefused((refused) => {
        const typed = !!browserDrafts().read(draftKeys.object(refused.address))?.trim()
        if (decodeURIComponent(at.current).includes(refused.fileId)) navigate(`/app/folders/${refused.folder}`)
        showToast({ label: `Topic not created — ${refused.textBack || typed ? 'title and text' : 'title'} restored`, type: 'error' })
        setAgain(refused)
      }),
    [navigate, showToast],
  )

  if (!again) return null
  return (
    <StartTopicDialog
      key={again.address}
      initialTitle={again.title}
      folderName={again.folderName}
      parent={again.parent}
      onClose={() => setAgain(null)}
      onCreate={async (title) => {
        const result = await createTopic({
          folder: again.folder,
          title,
          parent: again.parent?.address,
          hasState: again.hasState,
          fileId: again.fileId,
          folderName: again.folderName,
          parentFile: again.parent,
        })
        if (!result.ok) {
          showToast({ label: result.reason, type: 'error' })
          return false
        }
        navigate(filePath(result.address, title))
        return true
      }}
    />
  )
}
