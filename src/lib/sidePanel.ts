import { useState } from 'react'

const KEY = 'peek.sidePanel.hidden'
/** The 7 October first cut remembered one choice for every file; read once, then dropped. */
const LEGACY_KEY = 'peek.sidePanel'
/** The files remembered, newest last; the oldest go first past this. */
const LIMIT = 500

/**
 * Whether a file's third column, its Overview, is shown (Katerina, 7 October).
 *
 * - **Open** when the file has something to show: another app's card, or a
 *   mention in Activity.
 * - **Closed** when there is nothing to show, so a file nobody has named
 *   keeps its two columns.
 * - **Closed** on a file the person closed it on before, when they come back
 *   to it: remembered per file, in this browser. Opening it again forgets
 *   that.
 *
 * Opening it by hand on a file with nothing to show holds for that visit
 * only; the next time, the file opens closed by the second rule.
 *
 * A browser that blocks storage still gets a working button; it forgets.
 */
export function useSidePanel(address: string | undefined, somethingToShow: boolean): { open: boolean; toggle: () => void } {
  const [hidden, setHidden] = useState(readHidden)
  // The file it was opened on by hand, where the rules above would keep it closed.
  const [shownOn, setShownOn] = useState<string | null>(null)
  const open = address != null && !hidden.includes(address) && (somethingToShow || shownOn === address)
  const toggle = () => {
    if (address == null) return
    const rest = hidden.filter((one) => one !== address)
    const next = open ? [...rest, address].slice(-LIMIT) : rest
    setHidden(next)
    setShownOn(open ? null : address)
    writeHidden(next)
  }
  return { open, toggle }
}

function readHidden(): string[] {
  try {
    window.localStorage.removeItem(LEGACY_KEY)
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((one): one is string => typeof one === 'string') : []
  } catch {
    return []
  }
}

function writeHidden(hidden: string[]) {
  try {
    if (hidden.length) window.localStorage.setItem(KEY, JSON.stringify(hidden))
    else window.localStorage.removeItem(KEY)
  } catch {
    // Nothing to do: the button still works for this visit.
  }
}
