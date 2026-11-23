import { useMemo, type ReactNode } from 'react'
import { KeptSearchContext } from '@estiva-app/launcher'
import { useKeptLauncher } from '@/components/useKeptLauncher'

/**
 * Holds the app's one command launcher above whatever page is drawn, so what
 * it keeps outlives a change of page (KIN-2): every page draws its own frame,
 * and a launcher inside one would be thrown away going from a topic to a DM.
 * A frame's search reads it with `useKeptSearch`.
 */
export function KeptLauncherProvider({ children }: { children: ReactNode }) {
  const { launcher, toggle, searchStatus, searchStatusLabel } = useKeptLauncher()
  const search = useMemo(() => ({ toggle, searchStatus, searchStatusLabel }), [toggle, searchStatus, searchStatusLabel])
  return (
    <KeptSearchContext.Provider value={search}>
      {children}
      {launcher}
    </KeptSearchContext.Provider>
  )
}
