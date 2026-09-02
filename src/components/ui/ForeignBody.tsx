import type { ResolvedSlot } from '@estiva-app/interop'
import { cn } from '@/lib/utils'
import { BodySegments, renderMarks } from './MessageBody'

/**
 * Another app's `body` slot, rendered — PRO-2.
 *
 * The slot carries which content model it is written in (SPEC §13.4, resolved
 * by `@estiva-app/interop`), and §13 forbids reading either model as the other.
 * So this branches on the declaration rather than on the text, which is the
 * same rule one level down: a legacy description that happens to begin with `{`
 * is marker text, because it carries no tag.
 *
 * **Marks, not Peek's tokens.** `renderMarks` with an identity run renderer
 * gives §13.1's six marks and nothing else. Peek's own messages additionally
 * resolve `[Topic]` chips, mentions and `PEEK-`/`PR#` references inside a run;
 * another app's body must not get that layer, because those tokens mean
 * something in Peek's corpus and nothing in Ship's. Rendering `PEE-8` in a Ship
 * description as a Peek reference chip would be inventing meaning in somebody
 * else's content.
 *
 * **No nested widgets either.** `MessageBody` renders a `nostr:naddr` in the
 * body as a widget below the text. Doing that here would put a widget inside a
 * widget's body, and two objects that reference each other would render until
 * something ran out — the recursion budget interop keeps for `list` has no
 * equivalent for prose.
 */
export function ForeignBody({ slot, className }: { slot: ResolvedSlot; className?: string }) {
  /*
    A block document, or a format specified after this was written.

    Plain text for both, and §13.5 says so in as many words: *"An app MAY render
    any body as plain text. Doing so is conformant; what this section forbids is
    interpreting a body as markup, not declining to format it."*

    They are one branch rather than two because the safe handling is identical
    and the reasons differ: nothing writes a block document yet — SPEC §13.3 is
    specified ahead of an implementation — so a real block renderer would be
    speculative code for a producer that does not exist, and it is RIC-5's
    anyway. An `unknown` format must never be parsed at all, whatever arrives.

    `whitespace-pre-wrap` because the one thing plain text still owes the reader
    is its own line breaks.
  */
  if (slot.format === 'blocks' || slot.format === 'unknown') {
    return (
      <p className={cn('whitespace-pre-wrap break-words text-xs text-text-secondary', className)}>
        {slot.value}
      </p>
    )
  }

  return (
    <div
      data-foreign-body
      className={cn('flex flex-col gap-1 break-words text-xs text-text-secondary leading-[1.4]', className)}
    >
      <BodySegments text={slot.value} renderLine={(line) => renderMarks(line, (run) => run)} />
    </div>
  )
}
