import { useState } from 'react'
import { IconArrowsDiagonal, IconArrowsDiagonalMinimize2, IconCheck } from '@tabler/icons-react'
import highlightsIcon from '@/assets/highlights icon.png'
import { Button } from './ui/Button'
import { HighlightPill } from './ui/HighlightPill'
import { SectionLabel } from './ui/SectionHeader'
import { HIGHLIGHT_FILL_CLASSES, type HighlightType } from '@/api'
import { cn } from '@/lib/utils'

// ── Highlights card ──
//
// An app-generated object in the message stream: highlights captured outside
// Peek (e.g. a Google Meet call) that land in the topic as a first-class
// card. Collapsed it is a one-line divider-style bar (icon chip, label, type
// swatches, time, Expand); expanded it shows the full content.
//
// The body is a BLOCK LIST, not fixed sections — content can be any mix of
// headings, plain text, bullet lists, highlight groups (pill + lines), and
// checkbox todos, so future sources aren't boxed into "key points/action
// items". The Figma reference (Scenario 1, node 792:14245) is one instance
// of this model.

export interface HighlightTodo {
  text: string
  /** Rendered as an inline @mention tag before the text. */
  assignee?: string
  done?: boolean
}

export type HighlightBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; lines: string[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'highlight'; type: HighlightType; lines: string[] }
  | { kind: 'todos'; items: HighlightTodo[] }

export interface HighlightsData {
  id: string
  /** e.g. "Kick off call" */
  title: string
  /** e.g. "10:30 AM" */
  timestamp: string
  blocks: HighlightBlock[]
}

interface HighlightsCardProps {
  data: HighlightsData
  defaultExpanded?: boolean
  className?: string
}

/** Unique highlight types present in the content, in order of appearance —
 *  drives the mini swatches in the header bar. */
function swatchTypes(blocks: HighlightBlock[]): HighlightType[] {
  const seen: HighlightType[] = []
  for (const b of blocks) {
    if (b.kind === 'highlight' && !seen.includes(b.type)) seen.push(b.type)
  }
  return seen
}

function TodoRow({ todo }: { todo: HighlightTodo }) {
  return (
    <div className="flex items-center gap-1 w-full min-w-0">
      <span
        className={cn(
          'size-4 rounded-sm shrink-0 flex items-center justify-center border',
          todo.done
            ? 'bg-accent-primary border-accent-primary text-text-inverse'
            : 'bg-bg-inset border-border-strong'
        )}
      >
        {todo.done && <IconCheck size={12} stroke={2.5} />}
      </span>
      {todo.assignee && (
        <span className="h-5 px-1 rounded-sm bg-bg-active flex items-center shrink-0 text-body-2 text-text-primary whitespace-nowrap">
          @{todo.assignee}
        </span>
      )}
      <span
        className={cn(
          'text-body-2 text-text-secondary truncate',
          todo.done && 'line-through text-text-muted'
        )}
      >
        {todo.text}
      </span>
    </div>
  )
}

function Block({ block }: { block: HighlightBlock }) {
  if (block.kind === 'heading') {
    // Extra top margin so a heading reads as a new section (12px total
    // against the container's 8px gap), matching the Figma rhythm.
    return (
      <p className="text-body-2-strong text-text-primary mt-1 first:mt-0">
        {block.text}
      </p>
    )
  }
  if (block.kind === 'text') {
    return (
      <div className="flex flex-col gap-[2px]">
        {block.lines.map((line, i) => (
          <p key={i} className="text-body-2 text-text-secondary">{line}</p>
        ))}
      </div>
    )
  }
  if (block.kind === 'bullets') {
    // List indent/markers come from the shared message-list CSS in index.css
    // ([data-highlights-card] ul) so bullets match sent messages exactly.
    return (
      <ul className="w-full">
        {block.items.map((item, i) => (
          <li key={i} className="text-body-2 text-text-secondary">{item}</li>
        ))}
      </ul>
    )
  }
  if (block.kind === 'highlight') {
    return (
      <div className="flex flex-col gap-1 items-start w-full">
        <HighlightPill type={block.type} />
        <ul className="w-full">
          {block.lines.map((line, i) => (
            <li key={i} className="text-body-2 text-text-secondary">{line}</li>
          ))}
        </ul>
      </div>
    )
  }
  // todos
  return (
    <div className="flex flex-col gap-[2px]">
      {block.items.map((todo, i) => (
        <TodoRow key={i} todo={todo} />
      ))}
    </div>
  )
}

export function HighlightsCard({ data, defaultExpanded = false, className }: HighlightsCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const types = swatchTypes(data.blocks)

  return (
    <div
      data-highlights-card
      className={cn(
        'bg-bg-elevated rounded-lg pl-3 pr-2 py-1.5 flex flex-col gap-2 w-full',
        className
      )}
    >
      {/* Header bar — the whole collapsed state, and the expanded card's top row */}
      <div className="flex items-center gap-2 w-full">
        <div className="flex items-center gap-2 shrink-0">
          <span className="size-4 rounded-sm bg-bg-inset flex items-center justify-center shrink-0 overflow-hidden">
            <img src={highlightsIcon} alt="" width={11} height={11} className="size-[11px]" />
          </span>
          <SectionLabel>Highlights</SectionLabel>
          {types.length > 0 && (
            <span className="flex items-center gap-[2px]">
              {types.map((t) => (
                <span key={t} className={cn('size-2 rounded-sm', HIGHLIGHT_FILL_CLASSES[t])} />
              ))}
            </span>
          )}
          <span className="text-caption text-text-muted whitespace-nowrap signal:font-mono signal:text-small signal:tracking-wide signal:tabular-nums">
            {data.timestamp}
          </span>
        </div>
        <div className="flex-1 h-px bg-border-subtle min-w-[8px]" />
        <Button
          variant="outlined"
          size="small"
          className="pr-1 shrink-0"
          leadingIcon={
            expanded ? (
              <IconArrowsDiagonalMinimize2 size={16} stroke={1.5} />
            ) : (
              <IconArrowsDiagonal size={16} stroke={1.5} />
            )
          }
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Minimize' : 'Expand'}
        </Button>
      </div>

      {/* Content */}
      {expanded && (
        <div className="py-2 pr-2 flex flex-col gap-2 items-start w-full">
          <p className="text-h3 text-text-primary mb-1">
            {data.title}
          </p>
          {data.blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </div>
      )}
    </div>
  )
}
