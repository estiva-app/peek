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
      className="min-w-[160px]"
      // The 4px is the rows' content's; on `className` it added to the
      // package's 8px from 0.12.6 on (migration docs D68, Finding 60).
      contentClassName="p-1"
    >
      {/* No heights here. This menu forced `h-9 px-3` on its rows and
          `h-7 px-3` on its heading, and was the only menu in Peek doing it —
          measured 36.00px against every other menu's 31.59px (2026-09-11).
          Katerina ruled the package was the one that should change: a menu
          row is never shorter than 36px now, so the rows Peek wanted are the
          rows it gets. The 12px inset goes with the override — the package
          insets a row by 8px, as it does in all six other menus. */}
      <MenuSection label="Remind me">
        {OPTIONS.map((o) => (
          <MenuItem key={o.label} label={o.label} onClick={() => onPick(Date.now() + o.ms)} />
        ))}
      </MenuSection>
    </Menu>
  )
}
