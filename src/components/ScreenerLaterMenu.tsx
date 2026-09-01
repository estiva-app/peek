import { useRef, useState } from 'react'
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
 * The "Later" button + its reminder-duration menu, on the shared shell
 * (2026-09-01): the portal, the container, the heading row and both exits
 * come from @estiva-app/ui's Menu — left-anchored to the trigger, which is
 * why the shell's `position` learnt a left edge. The button swallows its own
 * mousedown so the shell's outside-close and the click's toggle don't fight.
 */
export function ScreenerLaterMenu({ onPick }: { onPick: (untilMs: number) => void }) {
  const btnRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)

  return (
    <div ref={btnRef}>
      <Button
        variant="outlined"
        size="small"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => setRect(rect ? null : (btnRef.current?.getBoundingClientRect() ?? null))}
      >
        Later
      </Button>
      {rect && (
        <Menu onClose={() => setRect(null)} position={{ top: rect.bottom + 4, left: rect.left }} className="min-w-[160px] p-1">
          <MenuSection label="Remind me" className="h-7 px-3">
            {OPTIONS.map((o) => (
              <MenuItem
                key={o.label}
                className="h-9 px-3"
                label={o.label}
                onClick={() => {
                  setRect(null)
                  onPick(Date.now() + o.ms)
                }}
              />
            ))}
          </MenuSection>
        </Menu>
      )}
    </div>
  )
}
