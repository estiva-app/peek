import { useState } from 'react'

/** What the 7 October cuts remembered: one choice for every file, then closes per file. Dropped on first use. */
const LEGACY_KEYS = ['peek.sidePanel', 'peek.sidePanel.hidden']

/**
 * Whether a file's third column, its Overview, is shown (Katerina, 13 October).
 *
 * Closed whenever a file is opened, on every topic, issue and project, whether
 * it has something to show or not. The header's sidebar button opens it, and
 * that holds for the visit: open another file, or come back to this one, and
 * it is closed again.
 *
 * Nothing is remembered, so a browser that blocks storage behaves the same.
 */
export function useSidePanel(address: string | undefined): { open: boolean; toggle: () => void } {
  // The file it was opened on by hand.
  const [shownOn, setShownOn] = useState<string | null>(forgetLegacy)
  const open = address != null && shownOn === address
  const toggle = () => {
    if (address == null) return
    setShownOn(open ? null : address)
  }
  return { open, toggle }
}

function forgetLegacy(): null {
  try {
    for (const key of LEGACY_KEYS) window.localStorage.removeItem(key)
  } catch {
    // Nothing to do: there was nothing to read either.
  }
  return null
}
