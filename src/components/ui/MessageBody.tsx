import type { FC, ReactNode } from 'react'
import {
  IconCircleCheck,
  IconCircleDashed,
  IconBrandGithub,
  IconFile,
  IconFileTypePdf,
  IconPhoto,
  IconTable,
  IconPresentation,
} from '@tabler/icons-react'
import figmaIcon from '@/assets/figma icon.svg'
import linearIcon from '@/assets/linear icon.svg'
import { TOPICS } from '@/api'
import { APP_FILES, DOCUMENT_FILES } from '@/api'
import { INLINE_TOKEN_RE, matchReference, matchUrl } from '@/lib/textParsing'
import { cn } from '@/lib/utils'
import { ReferenceChip } from './ReferenceChip'
import type { ForeignObject } from '@estiva-app/interop'
import { ForeignObjectWidget } from './ForeignObjectWidget'
import {
  findNaddrs,
  pointerToAddress,
  referenceToPointer,
  stripNaddrs,
  toRenderTree,
} from '@estiva-app/protocol'
import type { RenderBlock, RenderFormat, RenderInline } from '@estiva-app/protocol'

// Inline token renderer shared by ConversationCard and ThreadReplyCard: turns
// [Topic]/[File] refs into chips (with live topic status icons), @/!@ mentions
// into pills, and PEEK-/PR#/build# tokens into ReferenceChips.

/**
 * Tokens inside one run of text that carries no `code` mark.
 *
 * **Marks are parsed before this runs, and the order is load-bearing.** It used
 * to be the other way round — split on mention tokens, then parse marks in each
 * part — which was fine while the dialect had no way to say *"this text is
 * literal"*. `code` says exactly that (SPEC §13.1: its content MUST NOT be
 * parsed for further marks), and under the old order `` `@Alice` `` would have
 * rendered a mention chip inside a code span.
 */
function renderTokens(text: string, isTopicResolved: (id: string) => boolean): ReactNode {
  const parts = text.split(INLINE_TOKEN_RE)
  if (parts.length === 1) return text
  return (
    <>
      {parts.map((part, i) => {
        // A user-typed URL → a real, clickable link. `break-all` lets long
        // URLs wrap instead of forcing the card to overflow horizontally.
        const url = matchUrl(part)
        if (url) {
          return (
            <span key={i}>
              <a
                href={url.href}
                target="_blank"
                rel="noopener noreferrer"
                data-interactive
                className="text-info-default underline underline-offset-2 break-all hover:opacity-80"
                onClick={(e) => e.stopPropagation()}
              >
                {url.href}
              </a>
              {url.trailing}
            </span>
          )
        }
        if (part.startsWith('[') && part.endsWith(']') && part.length > 2) {
          const title = part.slice(1, -1)
          const topic = TOPICS.find((t) => t.title === title)
          if (topic) {
            const resolved = isTopicResolved(topic.id)
            return (
              <span key={i} className="inline-flex items-center gap-1 rounded-sm px-1 mx-0.5 bg-bg-active text-text-primary text-sm font-normal select-none" style={{ verticalAlign: 'text-bottom', height: '1.4em' }}>
                <span className="relative inline-flex items-center justify-center w-4 h-4 shrink-0">
                  {resolved ? (
                    <IconCircleCheck size={16} stroke={1.5} className="text-success-default" />
                  ) : (
                    <IconCircleDashed size={16} stroke={1.5} className="text-text-secondary" />
                  )}
                </span>
                <span>{title}</span>
              </span>
            )
          }
          // App or document file
          const appFile = APP_FILES.find((f) => f.title === title)
          const docFile = DOCUMENT_FILES.find((f) => f.title === title)
          const fileApp = appFile?.app ?? docFile?.docType ?? ''
          const svgIcons: Record<string, string> = { figma: figmaIcon, linear: linearIcon }
          const tablerIcons: Record<string, FC<{ size: number; stroke: number; className?: string }>> = {
            github: IconBrandGithub, pdf: IconFileTypePdf, image: IconPhoto,
            spreadsheet: IconTable, presentation: IconPresentation,
          }
          const svgSrc = svgIcons[fileApp]
          const TablerIcon = tablerIcons[fileApp] ?? IconFile
          return (
            <span key={i} className="inline-flex items-center gap-1 rounded-sm px-1 mx-0.5 bg-bg-active text-text-primary text-sm font-normal select-none" style={{ verticalAlign: 'text-bottom', height: '1.4em' }}>
              {svgSrc ? (
                <img src={svgSrc} width={14} height={14} alt={fileApp} className="rounded-[2px] shrink-0" />
              ) : (
                <span className="flex items-center justify-center w-4 h-4 shrink-0 text-text-secondary">
                  <TablerIcon size={14} stroke={1.5} />
                </span>
              )}
              <span>{title}</span>
            </span>
          )
        }
        if (/^(?:!@|@)/.test(part) && part.length > 1) {
          // Same treatment the composer gives the tag while typing: urgent
          // mentions wear the warning colors, plain mentions the accent.
          const urgent = part.startsWith('!@')
          return (
            <span
              key={i}
              className={cn(
                'rounded-sm px-1 mx-0.5 text-sm font-normal select-none',
                urgent ? 'bg-warning-muted text-warning-default' : 'bg-accent-muted text-accent-primary'
              )}
            >
              {part}
            </span>
          )
        }
        if (matchReference(part)) {
          return <ReferenceChip key={i} label={part} />
        }
        return part ? <span key={i}>{part}</span> : null
      })}
    </>
  )
}



/**
 * One entry per referenced object, whichever notation it arrived in.
 *
 * `naddr1…` and `<kind>:<pubkey>:<d>` are two spellings of one address, so the
 * address is the identity. A string that parses as neither is kept as-is rather
 * than dropped: the widget renders nothing for it, which is the same outcome,
 * and silently discarding references here would hide the reason.
 */
function dedupeReferences(refs: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const ref of refs) {
    let key: string
    try {
      key = pointerToAddress(referenceToPointer(ref))
    } catch {
      key = ref
    }
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

/**
 * SPEC §13.2's block structure, laid out. One layout, two callers.
 *
 * `renderLine` is the seam: Peek's own messages render mentions and chips
 * inside a line, another app's body renders marks only. Extracted rather than
 * copied because a second implementation would disagree the first time the
 * dialect gained a construct — and §13.2 is a *specified* dialect now, so it
 * will.
 *
 * A fence is literal by definition: no marks, no mentions, no chips. That is
 * §13.1's rule about `code` one level up, and it is why `renderLine` is not
 * applied to one.
 */
/**
 * A resolved body, laid out. One parse path, whichever content model it is in.
 *
 * `toRenderTree` (SPEC §13.5, `@estiva-app/protocol`) hands back a tree with
 * marks decided and blocks decided — **nothing left to parse and nothing to
 * interpolate**. That is where the safety lives: an app mapping this cannot
 * accidentally render markup, because there is no markup in it. This component
 * only creates elements and sets text.
 *
 * It replaced a version that parsed marker segments here and rendered a block
 * document as raw JSON, because a block renderer would have been a second
 * implementation of §13.3.
 *
 * `renderRun` is the seam between the two callers: Peek's own messages resolve
 * mentions, `[Topic]` chips and `PEEK-`/`PR #` references inside a run, and
 * another app's body renders the run as text. The marks are the protocol's and
 * are shared; that token vocabulary is Peek's and is not.
 */
function withBreaks(text: string, renderRun: (run: string) => ReactNode): ReactNode {
  // §13.5: "a `\n` inside `inline` text is a line break, in both content
  // models... splitting on it is the consumer's whole obligation."
  const lines = text.split('\n')
  if (lines.length === 1) return renderRun(text)
  return lines.map((line, i) => (
    <span key={i}>
      {i > 0 && <br />}
      {renderRun(line)}
    </span>
  ))
}

function Inline({ runs, renderRun }: { runs?: RenderInline[]; renderRun: (run: string) => ReactNode }) {
  return (
    <>
      {(runs ?? []).map((run, k) =>
        run.marks.includes('code') ? (
          // `code` never combines with another mark and its content is never
          // parsed further — SPEC §13.1.
          <code key={k} className="rounded-sm bg-bg-active px-1 py-0.5 font-mono text-[0.9em] text-text-primary">
            {run.text}
          </code>
        ) : (
          <span
            key={k}
            className={cn(
              run.marks.includes('bold') && 'font-semibold',
              run.marks.includes('italic') && 'italic',
              run.marks.includes('underline') && 'underline underline-offset-2'
            )}
          >
            {withBreaks(run.text, renderRun)}
          </span>
        )
      )}
    </>
  )
}

function Block({ block, renderRun }: { block: RenderBlock; renderRun: (run: string) => ReactNode }) {
  const inline = <Inline runs={block.inline} renderRun={renderRun} />
  switch (block.type) {
    // Lists are native ul/ol so sent messages and the composer share the exact
    // same markers, indent, and item spacing (see index.css).
    case 'bulletList':
      return <ul>{(block.children ?? []).map((child, i) => <li key={i} className="break-words"><Inline runs={child.inline} renderRun={renderRun} /></li>)}</ul>
    case 'orderedList':
      return <ol>{(block.children ?? []).map((child, i) => <li key={i} className="break-words"><Inline runs={child.inline} renderRun={renderRun} /></li>)}</ol>
    case 'heading':
      // Same sizes the composer's h1/h2 get in index.css. Level 3 exists only
      // in a block document — §13.2's marker dialect stops at `##`.
      if (block.level === 1) return <h1>{inline}</h1>
      if (block.level === 3) return <h3>{inline}</h3>
      return <h2>{inline}</h2>
    case 'codeBlock':
      // A fence is literal by definition: no mentions, no marks, no reference
      // chips. Scrolls on its own so a long line cannot widen the card.
      return (
        <pre
          className="overflow-x-auto rounded-md bg-bg-active p-2 font-mono text-[0.9em] text-text-primary"
          data-language={block.language}
        >
          <code>{(block.inline ?? []).map((run) => run.text).join('')}</code>
        </pre>
      )
    case 'blockquote':
      // Native blockquote so sent messages and the composer share the exact
      // same border/padding/color (see index.css).
      return <blockquote><p>{inline}</p></blockquote>
    case 'horizontalRule':
      return <hr className="border-border-subtle" />
    default:
      /*
        paragraph, and everything Peek has no design for — `table`,
        `attachment`, `widget`, and a block type published after this was
        written (`unknown`).

        §13.3 is explicit: *"A reader encountering an unknown block type MUST
        render that block's inline text rather than dropping it, and MUST NOT
        drop the block silently."* A paragraph of its text is the honest
        degradation; a blank is the PEE-10 failure, where an object that renders
        empty is indistinguishable from one the reader may not see.
      */
      return <p data-block-type={block.type === 'paragraph' ? undefined : (block.typeName ?? block.type)}>{inline}</p>
  }
}

export function RenderBlocks({
  value,
  format,
  renderRun,
}: {
  value: string
  format: RenderFormat
  renderRun: (run: string) => ReactNode
}) {
  const blocks = value ? toRenderTree(value, format) : []
  return (
    <>
      {blocks.map((block, i) => (
        <Block key={i} block={block} renderRun={renderRun} />
      ))}
    </>
  )
}

export function MessageBody({ body, isTopicResolved, nostrReferences, resolvedObjects }: { body: string; isTopicResolved: (id: string) => boolean; nostrReferences?: string[]; resolvedObjects?: Record<string, ForeignObject> }) {
  // NIP-27: a `nostr:naddr…` anywhere in the body refers to another app's
  // object. Rendered as a block BELOW the text rather than inline, because a
  // widget is not a word.
  // 
  /**
   * Both sources, merged — not one *or* the other.
   *
   * An imported message carries its references as `a` tags, which sync stores
   * in `nostrReferences`; a message composed here has them only in its body.
   * Preferring the stored list meant that the moment a message came back from
   * the relay, its perfectly good `naddr` in the body stopped being read at all
   * (FEE-2). One list shadowing the other is fragile in a way that merging is
   * not: an entry that cannot be resolved now costs one missing widget rather
   * than every widget on the message.
   *
   * Deduplicated by address, because the two sources describe the same objects
   * in different notations and would otherwise render each one twice.
   */
  const references = dedupeReferences([...(nostrReferences ?? []), ...findNaddrs(body)])
  
  // The pointer itself is dropped from the prose (PEEK-18). It was left in
  // originally so a reader could copy it somewhere Peek cannot render, but that
  // trades a rare need against every reader of every message: the widget below
  // already says what the reference is, and says it in words.
  const text = stripNaddrs(body)
  // A message that was *only* a reference has nothing left to lay out.
  // `RenderBlocks` emits nothing for an empty string rather than an empty
  // paragraph that still takes a gap.
  return (
    <div data-message-body className="flex flex-col gap-1 text-sm text-text-secondary leading-[1.4] break-words">
      <RenderBlocks value={text} format="marker" renderRun={(run) => renderTokens(run, isTopicResolved)} />
      {references.map((naddr) => (
        <ForeignObjectWidget key={naddr} naddr={naddr} resolved={resolvedObjects?.[naddr]} />
      ))}
    </div>
  )
}
