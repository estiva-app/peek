import { useState } from 'react'

/**
 * A fold this browser remembers — the tree's per-Folder open state (FOL-21).
 *
 * `CollapsibleSection` remembers a fold on its own under `storageKey`, and
 * that is the manner the ticket named. It could not be used here, for a
 * reason that is the whole cost model of the tree: the section keeps its rows
 * mounted while closed, and what is inside a Folder's section is a relay read
 * (`useFolderContents`) that must not fire for a Folder nobody opened —
 * production holds 162, at three `POST /query` each against a meter of 300 a
 * minute. So the read is gated on the open state, which means the tree
 * has to *know* the state before the first toggle, and `storageKey` reports
 * it only after one. The package's own page names the way out — "an app that
 * wants it to spring open owns the state with `open`" — and this is that,
 * plus the memory the owned manner gives up.
 *
 * **A default, not a lock**, on the same terms as `FileTreeView`'s `expand`:
 * `fallback` decides until the person does, and stays live — a Folder springs
 * open when it becomes the one holding the open file and closes again when it
 * stops, unless it was toggled by hand, in which case the hand wins for ever
 * (well, until it is toggled again). Written to storage only on a toggle, so
 * a default never becomes a memory.
 *
 * A browser that blocks storage still gets a working fold; it forgets.
 */
export function useRememberedOpen(
  key: string,
  fallback: boolean,
): [open: boolean, setOpen: (next: boolean) => void] {
  const [choice, setChoice] = useState<boolean | null>(() => readRemembered(key))
  const setOpen = (next: boolean) => {
    setChoice(next)
    writeRemembered(key, next)
  }
  return [choice ?? fallback, setOpen]
}

const OPEN = 'open'
const CLOSED = 'closed'

export function readRemembered(key: string): boolean | null {
  try {
    const value = window.localStorage.getItem(key)
    return value === OPEN ? true : value === CLOSED ? false : null
  } catch {
    return null
  }
}

export function writeRemembered(key: string, open: boolean) {
  try {
    window.localStorage.setItem(key, open ? OPEN : CLOSED)
  } catch {
    // Nothing to do: the fold still works for this visit.
  }
}
