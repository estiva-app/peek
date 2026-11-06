import { useCallback, useEffect, useState } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { useForeignObjects } from './foreign'

/** A team's deleted files: `'loading'` while read, `'error'` when the relay did not answer. */
export type DeletedFilesState = ForeignObject[] | 'loading' | 'error'

/**
 * A team's deleted files, newest deleted first (SPEC §6.5, ALO-6) — Archive's Deleted tab. Read when the team opens
 * there (`folder` set) and not before: 160 teams read at once would be the relay's whole minute, as Archive learned.
 */
export function useDeletedFiles(folder: string | null): { state: DeletedFilesState; reload: () => Promise<void> } {
  const { deletedFiles } = useForeignObjects()
  const [state, setState] = useState<{ folder: string | null; files: DeletedFilesState }>({ folder: null, files: 'loading' })

  const reload = useCallback(async () => {
    if (!folder) return
    const files = await deletedFiles(folder).catch((): 'error' => 'error')
    setState({ folder, files })
  }, [folder, deletedFiles])

  useEffect(() => {
    void reload()
  }, [reload])

  // Another team's answer is not this one's: loading until this team's comes in.
  return { state: state.folder === folder ? state.files : 'loading', reload }
}
