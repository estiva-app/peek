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
import { INLINE_TOKEN_RE, matchReference, matchUrl, parseBodySegments, parseInlineMarks } from '@/lib/textParsing'
import { cn } from '@/lib/utils'
import { ReferenceChip } from './ReferenceChip'
import { ForeignObjectWidget } from './ForeignObjectWidget'
import { findNaddrs, pointerToAddress, referenceToPointer, stripNaddrs } from '../../../convex/nostr/nip19'

// Inline token renderer shared by ConversationCard and ThreadReplyCard: turns
// [Topic]/[File] refs into chips (with live topic status icons), @/!@ mentions
// into pills, and PEEK-/PR#/build# tokens into ReferenceChips.
/** Storage markers (`**`/`*`/`__`) → styled spans. Plain text comes back
 *  as-is so the common case adds no extra nodes. */
function renderMarkedText(text: string): ReactNode {
  const spans = parseInlineMarks(text)
  if (spans.length === 1 && !spans[0].bold && !spans[0].italic && !spans[0].underline) return text
  return spans.map((s, k) => (
    <span
      key={k}
      className={cn(
        s.bold && 'font-semibold',
        s.italic && 'italic',
        s.underline && 'underline underline-offset-2'
      )}
    >
      {s.text}
    </span>
  ))
}

function renderWithMentions(text: string, isTopicResolved: (id: string) => boolean): ReactNode {
  const parts = text.split(INLINE_TOKEN_RE)
  if (parts.length === 1) return renderMarkedText(text)
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
        return part ? <span key={i}>{renderMarkedText(part)}</span> : null
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

export function MessageBody({ body, isTopicResolved, nostrReferences }: { body: string; isTopicResolved: (id: string) => boolean; nostrReferences?: string[] }) {
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
  // A message that was *only* a reference has nothing left to lay out. Skip the
  // paragraph entirely rather than emitting an empty one that still takes a gap.
  const segments = text ? parseBodySegments(text) : []
  return (
    <div data-message-body className="flex flex-col gap-1 text-sm text-text-secondary leading-[1.4] break-words">
      {segments.map((seg, i) => {
        // Lists are native ul/ol so sent messages and the composer share the
        // exact same markers, indent, and item spacing (see index.css).
        if (seg.type === 'bullet') {
          return (
            <ul key={i}>
              {seg.items.map((item, j) => (
                <li key={j} className="break-words">{renderWithMentions(item, isTopicResolved)}</li>
              ))}
            </ul>
          )
        }
        if (seg.type === 'numbered') {
          return (
            <ol key={i}>
              {seg.items.map((item, j) => (
                <li key={j} className="break-words">{renderWithMentions(item, isTopicResolved)}</li>
              ))}
            </ol>
          )
        }
        if (seg.type === 'heading') {
          // Same sizes the composer's h1/h2 get in index.css.
          return seg.level === 1 ? (
            <h1 key={i}>{renderWithMentions(seg.text, isTopicResolved)}</h1>
          ) : (
            <h2 key={i}>{renderWithMentions(seg.text, isTopicResolved)}</h2>
          )
        }
        if (seg.type === 'quote') {
          // Native blockquote so sent messages and the composer share the
          // exact same border/padding/color (see index.css).
          return (
            <blockquote key={i}>
              <p>
                {seg.lines.map((line, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    {renderWithMentions(line, isTopicResolved)}
                  </span>
                ))}
              </p>
            </blockquote>
          )
        }
        return (
          <p key={i}>
            {seg.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {renderWithMentions(line, isTopicResolved)}
              </span>
            ))}
          </p>
        )
      })}
      {references.map((naddr) => (
        <ForeignObjectWidget key={naddr} naddr={naddr} />
      ))}
    </div>
  )
}
