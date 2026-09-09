import { Menu, MenuItem, MenuSection } from '@estiva-app/ui'
import { Button } from './ui/Button'

/** "Later" reminder options (user request 2026-07-15). Each returns an
 *  absolute timestamp after which the Screener item reappears. */
const OPTIONS: { label: string; ms: number }[] = [
  { label: 'In 1 hour', ms: 60 * 60 * 1000 },
  { label: 'In 3 hours', ms: 3 * 60 * 60 * 1000 },
  { label: 'Tomorrow', ms: 24 * 60 * 60 * 1000 },
  { label: 'In a week', ms: 7 * 24 * 60 * 60 * 1000 },
]

/**
 * The "Later" button + its reminder-duration menu.
 *
 * The menu owns its trigger (`@estiva-app/ui` 0.10.0), so everything this
 * file used to do to open one is gone: the wrapper div that existed only to
 * be measured, the `rect` state, the `getBoundingClientRect()`, the
 * `onMouseDown` guard that stopped the outside-press and the click's toggle
 * fighting, and the `setRect(null)` in every row. Base UI does the toggle,
 * the placement, the focus return and the first-row highlight, and a
 * `MenuItem` closes the menu by itself.
 */
export function ScreenerLaterMenu({ onPick }: { onPick: (untilMs: number) => void }) {
  return (
    <Menu
      trigger={<Button variant="outlined" size="small">Later</Button>}
      className="min-w-[160px] p-1"
    >
      {/* The heights here override the shared rows and are older than this
          change; they are a question of their own (PEEK-ADOPTION §13.4), and
          this commit must not move a pixel. */}
      <MenuSection label="Remind me" className="h-7 px-3">
        {OPTIONS.map((o) => (
          <MenuItem
            key={o.label}
            className="h-9 px-3"
            label={o.label}
            onClick={() => onPick(Date.now() + o.ms)}
          />
        ))}
      </MenuSection>
    </Menu>
  )
}
