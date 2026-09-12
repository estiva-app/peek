import { type ReactNode } from 'react'
import { Popover } from '@estiva-app/ui'

/**
 * The box a type-ahead popup hangs in — `@`, `!@`, `[` and `/`.
 *
 * **What this replaces (D47, 2026-09-12).** Each of the four popups used to
 * build its own shell: `document.createElement('div')`, `position: fixed`, a
 * `zIndex`, `document.body.appendChild`, and then `hangSuggestion()` to do the
 * arithmetic — read the caret's rect, measure the popup, prefer above, fall
 * below when there was no room, clamp to the window's edges, and repeat it on
 * the next animation frame because the first pass ran before React had
 * rendered anything to measure. Three copies of the container and one shared
 * 69-line helper, all of it a re-implementation of what the package's
 * `Popover` does through Base UI's positioner.
 *
 * Every behaviour that arithmetic was written for is kept, and none of it is
 * ours any more:
 *
 * - **above the caret, below when there is no room** — `side="top"`, which the
 *   package documents as a preference Base UI flips when that side has no
 *   room. That is the fix from 2026-09-08 (a menu drawn off the top of the
 *   window when you edited a message near the top of the stream), now the
 *   positioner's job rather than ours.
 * - **never off the left or right edge** — Base UI clamps to the viewport, so
 *   the hard-coded `MENU_WIDTH` each caller had to pass, because the container
 *   could not measure its own child, goes with it.
 * - **the box itself** — the panel is the package's `MenuPanel`, the same one
 *   the menus used to draw for themselves.
 * - **the scrolling** — the panel caps at the room actually available and
 *   scrolls in the package's own `ScrollArea` (D40), rather than each menu
 *   carrying `max-h-[360px] overflow-y-auto` and a native bar.
 *
 * **Focus stays in the text**, which is the whole reason these are not
 * `Menu`s: an anchored `Popover` never takes focus, so the editor's suggestion
 * plugin keeps the keyboard and the caret stays where the person is typing.
 * The rows are reached with the arrow keys through each menu's own ref, as
 * before.
 *
 * **`open` is always true and there is no `onOpenChange`**, deliberately: the
 * plugin owns this popup's life. It mounts the renderer when the query starts
 * and destroys it when the query ends, so an outside press or an Escape that
 * Base UI wanted to act on would close a panel the plugin still believed was
 * open. Escape is already handled one level up, where it also has to decide
 * whether it is closing the menu or cancelling the edit.
 */
export function SuggestionPopover({
  rect,
  width,
  maxHeight,
  ariaLabel,
  children,
}: {
  /** The caret's rect, from the suggestion plugin's `clientRect()`. */
  rect: DOMRect | null
  /** The panel's width, e.g. `w-[658px]` — it lands on the panel. */
  width: string
  /**
   * The cap on the rows, e.g. `max-h-[360px]` — the menus' own caps, kept.
   *
   * **It is load-bearing, and it goes on the package's `maxHeight` rather than
   * into `width`.** Measured 2026-09-12, both halves:
   *
   * - **Without any cap**, the `/` menu's full list is 724px tall — taller
   *   than the room above the caret *and* below it. Base UI answers a side
   *   with no room by trying the perpendicular ones, so the panel arrived to
   *   the **right** of the caret at full window height. A type-ahead belongs
   *   above the caret it is completing.
   * - **With the cap in the panel's class**, the panel measured 400px and the
   *   rows kept drawing to 559px, straight through its border and over the
   *   composer. The panel's children scroll in a viewport with a cap of its
   *   own, and that is what `maxHeight` reaches (estiva-ui `0.12.5`, B31).
   */
  maxHeight: string
  ariaLabel: string
  children: ReactNode
}) {
  if (!rect) return null
  return (
    <Popover
      anchor={rect}
      open
      side="top"
      align="left"
      className={width}
      maxHeight={maxHeight}
      ariaLabel={ariaLabel}
    >
      {children}
    </Popover>
  )
}
