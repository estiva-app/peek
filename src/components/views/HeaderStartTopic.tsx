import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconEdit } from '@tabler/icons-react'
import { ToolbarButton } from '@estiva-app/ui'
import { showStartedTopicWhenWritten, topLevelFolders, useFolders, useForeignObjects } from '@/api'
import { StartTopicDialog } from '@/components/StartTopicDialog'
import type { ListColumnName } from '@/lib/openedFrom'
import { filePath } from '@/lib/objectUrl'
import { useToast } from '@/lib/toast'

/** A column header's New topic button, one strip item in its `Toolbar`. */
export function NewTopicButton({ onClick }: { onClick: () => void }) {
  return (
    <ToolbarButton tooltip="New topic" aria-label="New topic" onClick={onClick}>
      <IconEdit size={16} stroke={1.5} />
    </ToolbarButton>
  )
}

/**
 * A column header's New topic (FOL-41; on Topics too since TOP-9): Start a
 * topic with its Folder to choose, since a header has no Folder in hand —
 * the Folders the tree draws, every one of which has state. Started, it
 * opens the new topic with `column` still lit in the rail; on Topics the
 * topic is among yours at once, since its author is a member.
 */
export function HeaderStartTopic({ column, defaultFolder, onClose }: {
  column: ListColumnName
  /** The Folder chosen first — the open one, in Folders; the team whose + was pressed. */
  defaultFolder?: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { createTopic } = useForeignObjects()
  const { folders } = useFolders()
  const topLevel = useMemo(() => (folders ? topLevelFolders(folders) : null), [folders])
  // The dialog picks its first Folder when it mounts, so it waits for the list rather than open on none.
  if (!topLevel) return null
  return (
    <StartTopicDialog
      // From Initiatives it starts an initiative: today's topic in the new word (Katerina, 16 November, Q-01 A).
      noun={column === 'topics' ? 'initiative' : 'topic'}
      folders={topLevel}
      defaultFolder={defaultFolder}
      onClose={onClose}
      onCreate={async (title, chosen, summary) => {
        const folder = chosen ?? defaultFolder
        if (!folder) return false
        // `hasState` from the listing `listFolders` answered, never guessed: a `kind:1852` against a Folder with no state empties it.
        const listed = folders?.find((candidate) => candidate.id === folder)
        /*
          Started from Teams, it is one of the team's topics (#): today's space mark, carried by the add that lists it,
          so it sits under its team rather than in Initiatives (Katerina, 16 November: a team's topics are its lasting
          rooms). One write: as a second one it lost to the add, and the topic came out an initiative (17 November).
        */
        const result = await createTopic({ folder, title, summary, hasState: listed?.hasState ?? false, folderName: listed?.name, ...(column === 'folders' ? { space: true } : {}) })
        if (!result.ok) {
          showToast({ label: result.reason, type: 'error', failure: 'not-created' })
          return false
        }
        // Its row in the column beside, once it is written: shown and marked, as the open page's (T-12).
        showStartedTopicWhenWritten(result.address)
        // Into the topic: under a filter the tree may not be showing it.
        navigate(filePath(result.address, title), { state: { column } })
        return true
      }}
    />
  )
}
