import type { ResolvedSlot } from '@estiva-app/interop'
import { cn } from '@/lib/utils'
import { RenderBlocks } from './MessageBody'

/**
 * Another app's `body` slot, rendered — PRO-2.
 *
 * The slot carries which content model it is written in (SPEC §13.4, resolved
 * by `@estiva-app/interop`), and §13 forbids reading either model as the other.
 * Passing it straight to `toRenderTree` is what makes that structural rather
 * than a rule to remember: the format is an argument, and a body is never
 * inspected to guess at one. §13.4's own case — a legacy description that
 * happens to begin with `{` is marker text, because it carries no tag — comes
 * out right without this file knowing it exists.
 *
 * **All three formats render.** This used to draw a block document as its raw
 * JSON, on the grounds that §13.5 permits declining to format and that a block
 * renderer would be a second implementation of §13.3. `toRenderTree` (RIC-6)
 * removed the trade: one resolution, and `unknown` still degrades to a single
 * unmarked paragraph, decided there rather than here so that no consumer gets
 * to guess.
 *
 * `format` still falls back to `marker` for a slot resolved by interop before
 * 0.8.0, which reported nothing for a body carried in a root tag. Nothing in
 * this repo can produce one — the dependency is `^0.8.0` — so it is a
 * belt-and-braces default rather than a live path.
 *
 * **Marks, not Peek's tokens.** The run renderer is the identity, so §13.1's
 * six marks arrive and nothing else. Peek's own messages additionally resolve
 * `[Topic]` chips and mentions inside a run, and another app's body must not
 * get that layer: a Ship description's `[Title]` is not a topic in Peek.
 *
 * Peek's own bodies auto-linked `PEEK-`/`PR #` tokens too until 2026-09-03,
 * and the argument this comment made against extending that here is what
 * retired them everywhere: a description saying `PR #34` means a PR in the
 * repo it was written in, and a chip pointing it at `github.com/peek/peek`
 * is a wrong answer stated confidently.
 *
 * **No nested widgets either.** `MessageBody` renders a `nostr:naddr` in the
 * body as a widget below the text. Doing that here would put a widget inside a
 * widget's body, and two objects that reference each other would render until
 * something ran out — the recursion budget interop keeps for `list` has no
 * equivalent for prose.
 */
export function ForeignBody({ slot, className }: { slot: ResolvedSlot; className?: string }) {
  return (
    <div
      data-foreign-body
      className={cn('flex flex-col gap-1 break-words text-xs text-text-secondary leading-[1.4]', className)}
    >
      <RenderBlocks value={slot.value} format={slot.format ?? 'marker'} renderRun={(run) => run} />
    </div>
  )
}
