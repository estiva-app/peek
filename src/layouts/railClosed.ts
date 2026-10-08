import { createContext, useContext } from 'react'

/*
  Whether the rail is closed. The top bar's menu button is `PeekFrame`'s, and the
  list column is drawn by each page, so the one reaches the other through here:
  `PeekFrame` holds the menu button and provides this around the card's columns,
  and each page hands it to the package's `ListColumn` as `collapsed`.

  Closed is `false` with no `PeekFrame` around it — a page mounted on its own in a
  test, a column in a story.
*/
export const RailClosed = createContext(false)

/** Whether the rail is closed: a page's `ListColumn` takes it as `collapsed`, and closes with the rail. */
export function useRailClosed() {
  return useContext(RailClosed)
}
