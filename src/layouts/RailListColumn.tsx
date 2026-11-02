import { ListColumn, type ListColumnProps } from '@estiva-app/ui'
import { useRailClosed } from './railClosed'

/**
 * A page's list column, closing with the rail: the package's `ListColumn`, with whether the rail is closed read
 * where `PeekFrame` provides it, inside the frame. A page that read it for itself, above its frame, never closed
 * (Desk and People, until 31 October).
 */
export function RailListColumn(props: Omit<ListColumnProps, 'collapsed'>) {
  return <ListColumn {...props} collapsed={useRailClosed()} />
}
