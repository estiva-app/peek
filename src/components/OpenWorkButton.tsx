import { IconCheck, IconLayoutDashboard } from '@tabler/icons-react'
import { Button, WithTooltip, shortcutLabel } from '@estiva-app/ui'
import { OPEN_WORK_KEY } from '@/lib/openWorkKey'

/**
 * A page's Add to Open work, the header's one button with words (TOPI-7): outlined and small, "Add to Open work", or
 * "In Open work" with a tick, pressed. Its tooltip names Ctrl/⌘+O, which the page binds. A topic's, a file's and a team
 * chat's page draw the same one (Katerina, 16 November, PL-11, F-08, Q-37).
 */
export function OpenWorkButton({ inIt, onToggle }: { inIt: boolean; onToggle: () => void }) {
  return (
    <WithTooltip label={inIt ? 'Take out of Open work' : 'Add to Open work'} shortcut={shortcutLabel(OPEN_WORK_KEY)}>
      <Button
        size="small"
        variant="outlined"
        leadingIcon={inIt ? <IconCheck size={14} stroke={1.5} /> : <IconLayoutDashboard size={14} stroke={1.5} />}
        aria-pressed={inIt}
        onClick={onToggle}
      >
        {inIt ? 'In Open work' : 'Add to Open work'}
      </Button>
    </WithTooltip>
  )
}
