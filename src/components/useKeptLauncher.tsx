import { useKeptLauncher as useKept, useKeptSearch as useSearch, type KeptLauncherBox, type KeptSearch } from '@estiva-app/launcher'
import { CommandLauncher } from '@/components/CommandLauncher'
import { captureLauncherContext, type LauncherContext } from '@/lib/launcherContext'

export type { KeptSearch }

const draw = (box: KeptLauncherBox<LauncherContext>) => (
  <CommandLauncher context={box.context} open={box.open} onHide={box.onHide} onClose={box.onClose} onState={box.onState} />
)

/**
 * Peek's command launcher as the frame holds it: opened by the bar's search
 * and Cmd/Ctrl+K, and hidden, not thrown away, while it holds something
 * (KIN-2).
 *
 * How it is held, and the dot on the search, are `@estiva-app/launcher`'s
 * since KIN-4, the same in every app. Peek adds what it captures at each open
 * (selection > composer > nothing, `lib/launcherContext`) and its own
 * `CommandLauncher`.
 *
 * **One for the whole app.** Every page draws its own frame, so the box lives
 * above the routes (`KeptLauncherProvider`, in `App`) and each frame's search
 * reads it (`useKeptSearch`): going from a topic to a DM or to Desk keeps it.
 */
export function useKeptLauncher() {
  return useKept(captureLauncherContext, draw)
}

/** The app's kept launcher, for a frame's search; `null` where nothing above holds one (a story, a test of one page). */
export function useKeptSearch(): KeptSearch | null {
  return useSearch()
}
