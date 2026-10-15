import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { FolderSummary } from '@estiva-app/interop'
import { useForeignObjects } from '@/api'
import { ArchiveDialog } from '@/components/ArchiveDialog'
import { CreateFolderDialog } from '@/components/CreateFolderDialog'
import { StartTopicDialog } from '@/components/StartTopicDialog'
import type { FolderAction } from '@/components/views/useFolderActions'
import { archiveImpactWords } from '@/lib/archiveWords'
import { filePath } from '@/lib/objectUrl'
import { useToast } from '@/lib/toast'

/**
 * The dialog of the action chosen. Beside the tree, not inside a section: a
 * section is unmounted by the re-read that follows a write, and a dialog
 * unmounted mid-flight takes its own "did this work" reporting with it.
 */
export function FolderActionDialog({
  action,
  folders,
  reload,
  onClose,
}: {
  action: FolderAction
  folders: FolderSummary[] | null
  reload: () => Promise<unknown>
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { createTopic, renameFolder, archiveFolder, archiveImpact } = useForeignObjects()
  const { showToast } = useToast()
  const { folder } = action
  const name = folder.name ?? 'Untitled folder'

  /* What archiving would hide, read once as the dialog opens (FOL-46): a warning with no counts would say it hides nothing. */
  const [impact, setImpact] = useState<{ hides: string[]; staysVisible: string[] } | null>(null)
  // Asked once per dialog; an answer after it closed is dropped.
  const asked = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  /*
    Archive and Unarchive say what happened, and Archive can be undone from
    the toast (Katerina, 5 October): the Folder leaves the list it was in,
    and Undo — or Unarchive in the Archive view — brings it back.
  */
  const setArchived = async (archived: boolean, resolution?: string): Promise<boolean> => {
    const result = await archiveFolder({ folder: folder.id, channel: folder.channel!, archived, resolution }).catch((error: unknown) => ({
      ok: false as const,
      reason: `Nothing was ${archived ? 'archived' : 'unarchived'}: ${(error as Error)?.message ?? 'the write failed'}. Try again.`,
    }))
    if (!result.ok) {
      showToast({ label: result.reason, type: 'error' })
      return false
    }
    await reload()
    showToast(
      archived
        ? { label: `Archived “${name}”`, type: 'success', actionLabel: 'Undo', onAction: () => void setArchived(false) }
        : { label: `Unarchived “${name}”`, type: 'success' },
    )
    return true
  }

  // Unarchive asks nothing: it hides nothing, and runs as it is chosen.
  const unarchived = useRef(false)
  useEffect(() => {
    if (action.kind !== 'unarchive' || !folder.channel || unarchived.current) return
    unarchived.current = true
    void setArchived(false).finally(onClose)
  })

  useEffect(() => {
    if (action.kind !== 'archive' || !folder.channel || asked.current) return
    asked.current = true
    archiveImpact(folder.channel, folders ?? undefined)
      .then((read) => {
        if (alive.current) setImpact(archiveImpactWords(read))
      })
      .catch(() => {
        if (!alive.current) return
        showToast({ label: 'What archiving would hide could not be read, so nothing was archived. Try again.', type: 'error' })
        onClose()
      })
  }, [action.kind, folder.channel, folders, archiveImpact, showToast, onClose])

  if (action.kind === 'topic') {
    return (
      <StartTopicDialog
        folderName={name}
        defaultFolder={folder.id}
        onClose={onClose}
        onCreate={async (title) => {
          const result = await createTopic({ folder: folder.id, title, hasState: folder.hasState, folderName: name })
          if (!result.ok) {
            showToast({ label: result.reason, type: 'error' })
            return false
          }
          // Into the topic: under a filter the tree may not be showing it.
          navigate(filePath(result.address, title))
          return true
        }}
      />
    )
  }
  if (action.kind === 'rename') {
    return (
      <CreateFolderDialog
        rename={folder.name ?? ''}
        onClose={onClose}
        onCreate={async (next) => {
          const result = await renameFolder(folder.id, next)
          if (!result.ok) {
            showToast({ label: result.reason, type: 'error' })
            return false
          }
          await reload()
          return true
        }}
      />
    )
  }
  if (action.kind === 'unarchive' || !folder.channel) return null
  /*
    Open at once, counting (5 October): it used to appear only once the count
    was in, and an Archive… chosen on another Folder meanwhile showed the first
    one's numbers under the second's name. The dialog is keyed by its Folder
    (`FolderTree`), so a count belongs to the dialog that asked for it.
  */
  return (
    <ArchiveDialog
      title={name}
      what="folder"
      hides={impact?.hides ?? null}
      staysVisible={impact?.staysVisible}
      onClose={onClose}
      // A refused sign throws (a 429 under load); `setArchived` says so rather than closing silently.
      onArchive={(resolution) => setArchived(true, resolution || undefined)}
    />
  )
}
