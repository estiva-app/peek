import { createContext, useContext, type ReactNode } from 'react'
import { ListColumn, type ListColumnProps } from '@estiva-app/ui'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'

/*
  Whether the rail is closed. The top bar's menu button is `AppShell`'s, and the
  list column is drawn by each page, so the one reaches the other through here.
  Closed is `false` with no `AppShell` around it — a page mounted on its own in a
  test, a column in a story.
*/
const RailClosed = createContext(false)

/**
 * Tells the page's list column whether the rail is closed: `AppShell` holds the
 * menu button that closes it and wraps the card's columns in this.
 */
export function ListColumnsClosed({ closed, children }: { closed: boolean; children: ReactNode }) {
  return <RailClosed value={closed}>{children}</RailClosed>
}

/**
 * A page's list column: the package's `ListColumn`, closing with the rail, with
 * its own error boundary.
 *
 * The column's look is the package's (UIG-14, N9): 290px, its line, the header,
 * the list's insets and gaps, and the 300ms narrowing and fade when the rail
 * closes. What is Peek's is where the closed state comes from (`AppShell`'s menu
 * button, through `ListColumnsClosed`), and what a crash does: the boundary sits
 * around the whole column, so a row, the header's actions or the row `above`
 * that throws is caught here. The message is drawn in a column of its own, with
 * the column's name, in the column's place — never across the page, and the
 * rest of the page keeps working. "Try again" draws the column again.
 */
export function PageListColumn(props: Omit<ListColumnProps, 'collapsed'>) {
  const closed = useContext(RailClosed)
  return (
    <ErrorBoundary
      label="list panel"
      frame={(message) => (
        // Only the name comes back with the message: the actions and the row
        // above may be what threw.
        <ListColumn title={props.title} chevron={props.chevron} collapsed={closed} className={props.className}>
          {message}
        </ListColumn>
      )}
    >
      <ListColumn {...props} collapsed={closed} />
    </ErrorBoundary>
  )
}
