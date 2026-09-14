import { useState } from 'react'
import { Link, ProgressBar } from '@estiva-app/ui'
import { EmptyState } from './EmptyState'
import { IconChevronRight } from '@tabler/icons-react'
import type { ForeignObject, ResolvedSlot } from '@estiva-app/interop'
import { StatusPill } from './ForeignObjectWidget'
import { cn } from '@/lib/utils'

/**
 * How much of the work is behind you.
 *
 * The counts already say it, but a number is read and a bar is *seen* — and
 * "how is this project going" is the question somebody opens a project with.
 * Rides the same line as the count and stays deliberately quiet: two hairlines
 * of muted colour, no legend, no percentage. It is a glance, not a chart.
 *
 * The package's ProgressBar, its `quiet` look (UIG-27): 4px by Katerina's
 * ruling of 14 September, where this bar was 3px.
 */
function Progress({ done, open }: { done: number; open: number }) {
  const total = done + open
  if (total === 0) return null

  return <ProgressBar value={done} max={total} label={`${done} of ${total} tickets done`} variant="quiet" className="flex-1" />
}

/**
 * A ticket's key — `FEE-1` — when the owning app publishes one.
 *
 * **Not `subtitle`.** That was the first guess and it was wrong in the only
 * place that mattered: Ship maps `subtitle` to the issue's *description*
 * (`{field: 'content', truncate: 120}`), so the column filled with the opening
 * words of each ticket's body. The fixtures said otherwise because they were
 * written to the guess, which is exactly how it survived Storybook and failed
 * in production (2026-08-20).
 *
 * The key is a `meta` slot, and the rule for finding it is deliberately about
 * *shape* rather than about Ship: a meta entry with **no label** and no pubkey
 * is an identifier — the labelled ones are properties ("Assignee", "Lead") and
 * say so. Nothing here knows the tag is called `ref`.
 */
function keyOf(ticket: ForeignObject): string | undefined {
  const identifier = ticket.meta.find(
    (slot: ResolvedSlot) => !slot.label && !slot.isPubkey && slot.value,
  )
  return identifier?.value
}

/**
 * A project's tickets: a count you can open, and the list behind it.
 *
 * Extracted from the Files panel so the topic details dialog shows a project's
 * work the same way (PEE-2) — the same accordion, the same counter, the same
 * bar, the same rows. Two renderings of one thing is how they drift, and these
 * two are a click apart.
 *
 * Shut by default in both. The count and the bar answer the question most
 * people arrive with; the list is for when they do not.
 */
export function ProjectTickets({
  tickets,
  openCount,
  doneCount,
  className,
}: {
  tickets: ForeignObject[]
  openCount: number
  doneCount: number
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={className}>
      <div className="flex items-center gap-3 border-t border-border-subtle px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex shrink-0 items-center gap-1 text-caption text-text-secondary hover:text-text-primary"
        >
          <IconChevronRight
            size={14}
            stroke={1.5}
            className={cn('shrink-0 transition-transform', expanded && 'rotate-90')}
          />
          {/*
           * Done over total: 0/3 nothing finished, 3/3 all of it. It used to be
           * open over done, which read as a fraction but was two separate
           * counts — "3/1" meant three left and one finished, and "0/2" meant
           * everything was done while looking like the opposite. Same total the
           * progress bar beside it already uses.
           *
           * Nothing at all for an empty project, on the reasoning that hides the
           * bar there too: "0/0" is a fraction of nothing, and reads as a broken
           * counter rather than as an empty project.
           */}
          Tickets{doneCount + openCount > 0 && ` (${doneCount}/${doneCount + openCount})`}
        </button>
        {/* Beside the button rather than inside it: a progressbar nested in a
            control folds its label into the button's accessible name. */}
        <Progress done={doneCount} open={openCount} />
      </div>

      {expanded &&
        (tickets.length === 0 ? (
          /* A hand-made empty line until 2026-09-10 (PEEK-ADOPTION.md 13.1). Level
             with the rows' words (Katerina, 2026-09-14): each row's cell pads
             itself, so the line takes that inset here, never on EmptyState. */
          <div className="border-t border-border-subtle px-3 py-2">
            <EmptyState scope="section" message="No tickets in this project yet." />
          </div>
        ) : (
          <table className="w-full table-fixed border-t border-border-subtle text-caption">
            <tbody>
              {tickets.map((ticket) => (
                /*
                 * The whole row opens the ticket, not just the words.
                 *
                 * Only the title was a link, so the row highlighted nothing and
                 * a click an inch to the right did nothing either. The anchor
                 * stretches over the row with `after:absolute`, which keeps one
                 * link per row — a second one wrapping the status would be the
                 * same destination announced twice.
                 *
                 * `group` so hovering anywhere on the row brightens and
                 * underlines the title. That is the whole affordance — no
                 * background fill, which would be a second answer to a question
                 * the title has already answered.
                 */
                <tr
                  key={ticket.address}
                  className="group relative border-b border-border-subtle last:border-b-0"
                >
                  <td className="max-w-0 truncate py-1.5 pl-3 pr-2">
                    {/*
                     * The key first — FEE-1, PEE-2 — because it is how people
                     * refer to a ticket out loud and in messages. Fixed-width
                     * and muted so a column of them lines up without competing
                     * with the titles beside it.
                     */}
                    {keyOf(ticket) && (
                      <span className="mr-2 inline-block w-[52px] shrink-0 truncate align-middle text-text-muted">
                        {keyOf(ticket)}
                      </span>
                    )}
                    {ticket.openUrl ? (
                      <Link
                        href={ticket.openUrl}
                        variant="plain"
                        external
                        className="text-text-secondary transition-colors after:absolute after:inset-0 group-hover:text-text-primary group-hover:underline"
                      >
                        {ticket.slots.title?.value ?? 'Untitled'}
                      </Link>
                    ) : (
                      <span className="text-text-secondary">
                        {ticket.slots.title?.value ?? 'Untitled'}
                      </span>
                    )}
                  </td>
                  <td className="w-[96px] py-1.5 pr-3 text-right align-middle">
                    {ticket.slots.status && <StatusPill slot={ticket.slots.status} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </div>
  )
}
