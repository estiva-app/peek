import { useCallback, useEffect, useRef, useState } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { useForeignObjects } from './foreign'

/**
 * Every deleted project the viewer can see: `'loading'` while read, `'error'` when the relay did not answer, and
 * `'unavailable'` where the relay has no list read to find them by.
 */
export type DeletedProjectsState = ForeignObject[] | 'loading' | 'error' | 'unavailable'

/**
 * Every deleted project the viewer can see, newest deleted first (SPEC §6.5, ALO-6) — Archive's Deleted tab, one
 * list across teams (Miky, 6 Nov). Read while `enabled` (Archive is open), in the background: the tab's count waits
 * for it, Archive's own rows do not. `reload` reads it again and keeps the list until the answer, as a Restore does;
 * `retry` shows it loading first, after a read that failed.
 */
export function useDeletedProjects(enabled: boolean): {
  state: DeletedProjectsState
  reload: () => Promise<void>
  retry: () => Promise<void>
} {
  const { deletedProjects } = useForeignObjects()
  const [state, setState] = useState<DeletedProjectsState>('loading')
  // Only the newest read's answer is drawn: two Restores close together, or Archive shown again, must not let an
  // older answer bring a restored project back.
  const latest = useRef(0)

  const reload = useCallback(async () => {
    if (!enabled) return
    const asked = ++latest.current
    const projects = await deletedProjects().catch((): 'error' => 'error')
    if (asked === latest.current) setState(projects === null ? 'unavailable' : projects)
  }, [enabled, deletedProjects])

  const retry = useCallback(async () => {
    setState('loading')
    await reload()
  }, [reload])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- set only once the relay answers, after an await
    void reload()
  }, [reload])

  return { state, reload, retry }
}
