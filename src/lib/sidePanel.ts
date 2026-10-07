import { useState } from 'react'

const KEY = 'peek.sidePanel'
const HIDDEN = 'hidden'

/**
 * Whether a file's third column, its Overview, is shown (Katerina, 7 October).
 *
 * - Shown when there is something to show — another app's card, or a
 *   mention — and hidden when there is nothing, so a file nobody has named
 *   keeps its two columns.
 * - The header's sidebar button changes that. Hiding it is remembered in
 *   this browser, for every file, until the button shows it again. Showing it
 *   on a file with nothing to show holds for that file only: the next empty
 *   one opens hidden, by the first rule.
 *
 * A browser that blocks storage still gets a working button; it forgets.
 */
export function useSidePanel(address: string | undefined, somethingToShow: boolean): { open: boolean; toggle: () => void } {
  const [hidden, setHidden] = useState(readHidden)
  // The file the person opened it on by hand, where the first rule would have hidden it.
  const [shownOn, setShownOn] = useState<string | null>(null)
  const open = !hidden && (somethingToShow || (address != null && shownOn === address))
  const toggle = () => {
    if (open) {
      setHidden(true)
      setShownOn(null)
      writeHidden(true)
    } else {
      setHidden(false)
      setShownOn(address ?? null)
      writeHidden(false)
    }
  }
  return { open, toggle }
}

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(KEY) === HIDDEN
  } catch {
    return false
  }
}

function writeHidden(hidden: boolean) {
  try {
    if (hidden) window.localStorage.setItem(KEY, HIDDEN)
    else window.localStorage.removeItem(KEY)
  } catch {
    // Nothing to do: the button still works for this visit.
  }
}
