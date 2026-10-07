import { IconLayoutSidebarRight } from '@tabler/icons-react'
import { ToolbarButton } from '@estiva-app/ui'

/**
 * The file header's button that shows and hides the third column, the file's
 * Overview (Katerina, 7 October; Jan's PEEK-24 icon, brought back). Pressed
 * while the column is shown. A `ToolbarButton`, so it goes in the header's
 * `Toolbar`, before the ⋮.
 */
export function SidePanelButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? 'Hide side panel' : 'Show side panel'
  return (
    <ToolbarButton tooltip={label} aria-label={label} pressed={open} onClick={onToggle}>
      <IconLayoutSidebarRight size={16} stroke={1.5} />
    </ToolbarButton>
  )
}
