import { PEOPLE } from '@/data/peopleData'
import { TOPICS } from '@/data/topicData'
import { APP_FILES, DOCUMENT_FILES } from '@/data/filesData'

// ── Mention regex ──
//
// Matches: @FullName / !@FullName (PEOPLE), @lowercase-handle (teams/groups
// like @backend-team, @devops), and [Topic Title] / [File Title] brackets.
// The lookahead (?![a-zA-Z/-]) prevents partial matches inside camelCase or
// package paths (e.g. @testing-library/react is left as plain text). The `-`
// in the carve-out is critical: without it, regex backtracking would let
// `@testing` match because the next char is `-` (a handle continuation char).
//
// Names are sorted longest-first so partial-overlap candidates ("Bob" vs
// "Bob Smith") don't shadow the longer match.

// Whose names render as mention chips. Defaults to the mock cast; the seam
// swaps in the real workspace directory at runtime (src/api/mentions.tsx) so a
// real teammate's @mention renders as a chip too, not as plain text.
let _mentionNames: string[] = PEOPLE.map((p) => p.name)

const _escapedNames = () =>
  _mentionNames
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|')

const _escapedBracketTitles = [
  ...TOPICS.map((t) => t.title),
  ...APP_FILES.map((f) => f.title),
  ...DOCUMENT_FILES.map((f) => f.title),
]
  .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .sort((a, b) => b.length - a.length)
  .join('|')

function _buildMentionRe(): RegExp {
  return new RegExp(
    `((?:!@|@)(?:${_escapedNames()})|@[a-z][a-z0-9-]+(?![a-zA-Z/-])|\\[(?:${_escapedBracketTitles})\\])`,
    'g'
  )
}

/** `g`-flagged — use matchAll/split, never rely on lastIndex across calls. */
export let MENTION_RE = _buildMentionRe()

/** The seam calls this when the workspace directory changes. Rebuilds BOTH
 *  regexes — INLINE_TOKEN_RE is the one read-only bodies actually render with,
 *  so forgetting it would leave real teammates' mentions as plain text. */
export function setMentionNames(names: string[]) {
  _mentionNames = names.length ? names : PEOPLE.map((p) => p.name)
  MENTION_RE = _buildMentionRe()
  INLINE_TOKEN_RE = _buildInlineTokenRe()
}

// ── External references (auto-linked) ──
//
// Text patterns that clearly point at something in a connected app become
// clickable reference chips in read-only message bodies (same pill treatment
// as [file] mentions, plus a pointer cursor + hover underline).
//
// Order matters: the worded forms ("Zendesk ticket #48821", "PR #482",
// "Build #4821") must come before the bare `#123` fallback so the context
// word is captured as part of the chip label.

const _referenceAlternation = [
  '(?:Zendesk )?[Tt]icket #\\d+',
  'PR #\\d+',
  '[Bb]uild #\\d+',
  'PEEK-\\d+',
  '#\\d+(?!\\d)',
].join('|')

/** Bare http(s) URL. Listed FIRST in the tokenizer so a URL is matched
 *  whole (greedily to the next whitespace) before its inner `#123` etc. can
 *  be mistaken for a reference. */
const _urlPattern = 'https?:\\/\\/[^\\s]+'

/** Tokenizer for read-only rendering: URLs, mentions, [refs], and external
 *  references. Single capture group so String.split() interleaves cleanly.
 *  Rebuilt alongside MENTION_RE when the workspace directory changes. */
function _buildInlineTokenRe(): RegExp {
  return new RegExp(
    `(${_urlPattern}|(?:!@|@)(?:${_escapedNames()})|@[a-z][a-z0-9-]+(?![a-zA-Z/-])|\\[(?:${_escapedBracketTitles})\\]|${_referenceAlternation})`,
    'g'
  )
}

export let INLINE_TOKEN_RE = _buildInlineTokenRe()

/** A plain http(s) URL token → its href plus any trailing punctuation peeled
 *  off, so "see https://x.com." links only the URL and leaves the period as
 *  text. Returns null for non-URL tokens. */
export function matchUrl(part: string): { href: string; trailing: string } | null {
  const m = part.match(/^(https?:\/\/\S+?)([.,;:!?)\]]*)$/)
  return m ? { href: m[1], trailing: m[2] } : null
}

export type ReferenceKind = 'linear' | 'github' | 'build' | 'ticket'

export interface ReferenceMatch {
  kind: ReferenceKind
  href: string
}

/** Classify a token produced by INLINE_TOKEN_RE as an external reference.
 *  Returns null for mentions/brackets/plain text. Hrefs are plausible
 *  destinations in the connected apps (prototype: links are inert). */
export function matchReference(part: string): ReferenceMatch | null {
  const num = part.match(/\d+/)?.[0]
  if (/^PEEK-\d+$/.test(part)) {
    return { kind: 'linear', href: `https://linear.app/peek/issue/${part}` }
  }
  if (/^(?:Zendesk )?[Tt]icket #\d+$/.test(part)) {
    return { kind: 'ticket', href: `https://peek.zendesk.com/agent/tickets/${num}` }
  }
  if (/^[Bb]uild #\d+$/.test(part)) {
    return { kind: 'build', href: `https://github.com/peek/peek/actions/runs/${num}` }
  }
  if (/^(?:PR )?#\d+$/.test(part)) {
    return { kind: 'github', href: `https://github.com/peek/peek/pull/${num}` }
  }
  return null
}

// ── Inline formatting marks (rich text, 2026-07) ──
//
// Storage stays plain text; formatting is markdown-style markers:
//   **bold**   *italic*   __underline__   ***bold italic***
// plus `# ` / `## ` line prefixes for headline / subheading (see
// parseBodySegments). Rules that keep old messages rendering unchanged:
//   - a marker pair only counts when the inner text has no whitespace at its
//     edges (`** text**` stays literal), and
//   - markers must sit on word boundaries (`2*3*4` stays literal math).
// Nesting is parsed recursively, so `__**both**__` works.

export interface InlineMarkSpan {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

type MarkKey = 'bold' | 'italic' | 'underline'

// Longest token first so `***` isn't consumed as `**` + dangling `*`.
const MARK_TOKENS: Array<{ token: string; keys: MarkKey[] }> = [
  { token: '***', keys: ['bold', 'italic'] },
  { token: '**', keys: ['bold'] },
  { token: '__', keys: ['underline'] },
  { token: '*', keys: ['italic'] },
]

const isWordChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9]/.test(ch)

function findMarkClose(text: string, token: string, from: number): number {
  let idx = text.indexOf(token, from)
  while (idx !== -1) {
    if (!isWordChar(text[idx + token.length])) return idx
    idx = text.indexOf(token, idx + 1)
  }
  return -1
}

function toMarkSpan(text: string, active: MarkKey[]): InlineMarkSpan {
  const span: InlineMarkSpan = { text }
  for (const key of active) span[key] = true
  return span
}

function scanMarks(text: string, active: MarkKey[]): InlineMarkSpan[] {
  for (let i = 0; i < text.length; i++) {
    for (const { token, keys } of MARK_TOKENS) {
      if (keys.some((k) => active.includes(k))) continue
      if (!text.startsWith(token, i)) continue
      if (isWordChar(text[i - 1])) continue
      const close = findMarkClose(text, token, i + token.length)
      if (close === -1) continue
      const inner = text.slice(i + token.length, close)
      if (!inner || /^\s/.test(inner) || /\s$/.test(inner)) continue
      const spans: InlineMarkSpan[] = []
      const before = text.slice(0, i)
      if (before) spans.push(toMarkSpan(before, active))
      spans.push(...scanMarks(inner, [...active, ...keys]))
      spans.push(...scanMarks(text.slice(close + token.length), active))
      return spans
    }
  }
  return text ? [toMarkSpan(text, active)] : []
}

/** Parse one plain-text run (no mentions/refs — split those out first) into
 *  styled spans. Returns a single unstyled span when there's nothing to do. */
export function parseInlineMarks(text: string): InlineMarkSpan[] {
  return scanMarks(text, [])
}

/** Wrap a text node's content in storage markers for its Tiptap marks.
 *  Edge whitespace is hoisted outside the markers (`**word **` would not
 *  parse back), so bolding "word " round-trips as `**word** `. */
export function wrapInlineMarks(text: string, markNames: ReadonlySet<string>): string {
  if (!text) return text
  const bold = markNames.has('bold')
  const italic = markNames.has('italic')
  const underline = markNames.has('underline')
  if (!bold && !italic && !underline) return text
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!
  const [, lead, core, trail] = m
  if (!core) return text
  let out = core
  if (bold && italic) out = `***${out}***`
  else if (bold) out = `**${out}**`
  else if (italic) out = `*${out}*`
  if (underline) out = `__${out}__`
  return lead + out + trail
}

/** Markers + heading prefixes removed — for one-line previews/snippets that
 *  render raw body text outside MessageBody. */
export function stripInlineFormatting(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      parseInlineMarks(line.replace(/^#{1,2}\s/, '').replace(/^>\s/, ''))
        .map((s) => s.text)
        .join('')
    )
    .join('\n')
}

// ── Inline content parser ──

/** Parse a single line into Tiptap inline JSON nodes (text + mention nodes,
 *  with bold/italic/underline marks parsed from storage markers). */
export function parseInlineContent(line: string): Record<string, unknown>[] {
  const parts = line.split(MENTION_RE)
  const content: Record<string, unknown>[] = []
  for (const part of parts) {
    if (!part) continue
    if (part.startsWith('!@') && part.length > 2) {
      const name = part.slice(2)
      const person = PEOPLE.find((p) => p.name === name)
      content.push({ type: 'urgentMention', attrs: { id: person?.id ?? name, label: name } })
    } else if (part.startsWith('@') && part.length > 1) {
      const name = part.slice(1)
      const person = PEOPLE.find((p) => p.name === name)
      content.push({ type: 'mention', attrs: { id: person?.id ?? name, label: name } })
    } else if (part.startsWith('[') && part.endsWith(']') && part.length > 2) {
      const title = part.slice(1, -1)
      const topic = TOPICS.find((t) => t.title === title)
      if (topic) {
        content.push({
          type: 'topicMention',
          attrs: {
            id: topic.id,
            label: title,
            isResolved: topic.isResolved,
          },
        })
      } else {
        const appFile = APP_FILES.find((f) => f.title === title)
        const docFile = DOCUMENT_FILES.find((f) => f.title === title)
        const file = appFile ?? docFile
        content.push({
          type: 'fileMention',
          attrs: {
            id: file?.id ?? title,
            label: title,
            app: appFile?.app ?? docFile?.docType ?? '',
            subtitle: file?.subtitle ?? '',
          },
        })
      }
    } else {
      for (const span of parseInlineMarks(part)) {
        const marks: Array<{ type: string }> = []
        if (span.bold) marks.push({ type: 'bold' })
        if (span.italic) marks.push({ type: 'italic' })
        if (span.underline) marks.push({ type: 'underline' })
        content.push(
          marks.length ? { type: 'text', text: span.text, marks } : { type: 'text', text: span.text }
        )
      }
    }
  }
  return content
}

// ── Tiptap → text serializer ──
//
// The Tiptap node shape isn't directly importable for our purposes; we use a
// minimal structural type matching only the methods/fields we touch.

interface TiptapInlineChild {
  type: { name: string }
  attrs: Record<string, string>
  text?: string
  marks?: ReadonlyArray<{ type: { name: string } }>
}

interface TiptapNode {
  forEach: (cb: (child: TiptapInlineChild) => void) => void
}

/** Serialize a Tiptap inline node (paragraph or list-item paragraph) back to text. */
export function serializeInline(node: TiptapNode): string {
  let text = ''
  node.forEach((child) => {
    if (child.type.name === 'highlightTag') { /* skip */ }
    else if (child.type.name === 'hardBreak') {
      text += '\n'
    } else if (child.type.name === 'mention') {
      text += `@${child.attrs.label}`
    } else if (child.type.name === 'urgentMention') {
      text += `!@${child.attrs.label}`
    } else if (child.type.name === 'topicMention') {
      text += `[${child.attrs.label}] `
    } else if (child.type.name === 'fileMention') {
      text += `[${child.attrs.label}] `
    } else {
      const markNames = new Set((child.marks ?? []).map((m) => m.type.name))
      text += wrapInlineMarks(child.text ?? '', markNames)
    }
  })
  return text
}

// ── Body segments (for read-only rendering of plain-text bodies) ──

export type BodySegment =
  | { type: 'text'; lines: string[] }
  | { type: 'bullet'; items: string[] }
  | { type: 'numbered'; items: string[] }
  | { type: 'heading'; level: 1 | 2; text: string }
  | { type: 'quote'; lines: string[] }

const HEADING_LINE_RE = /^#{1,2}\s/
/** `> ` with the space required — a bare `>` (e.g. "5 > 3" typed at a line
 *  start) stays literal text, same conservatism as the other markers. */
const QUOTE_LINE_RE = /^>\s/

/** Split a multi-line body string into a list of segments (text / bullet /
 *  numbered / heading). Blank lines split runs of plain text into separate
 *  `text` segments. `# ` and `## ` prefixes become heading segments; three or
 *  more #s (or `#123` refs, no space) stay plain text. */
export function parseBodySegments(body: string): BodySegment[] {
  const lines = body.split('\n')
  const segments: BodySegment[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (HEADING_LINE_RE.test(line) && !line.startsWith('###')) {
      segments.push({
        type: 'heading',
        level: line.startsWith('##') ? 2 : 1,
        text: line.replace(HEADING_LINE_RE, ''),
      })
      i++
    } else if (/^[-•]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-•]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-•]\s/, ''))
        i++
      }
      segments.push({ type: 'bullet', items })
    } else if (/^\d+\.\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ''))
        i++
      }
      segments.push({ type: 'numbered', items })
    } else if (QUOTE_LINE_RE.test(line)) {
      const quoteLines: string[] = []
      while (i < lines.length && QUOTE_LINE_RE.test(lines[i])) {
        quoteLines.push(lines[i].replace(QUOTE_LINE_RE, ''))
        i++
      }
      segments.push({ type: 'quote', lines: quoteLines })
    } else {
      const textLines: string[] = []
      while (
        i < lines.length &&
        !/^[-•]\s/.test(lines[i]) &&
        !/^\d+\.\s/.test(lines[i]) &&
        !QUOTE_LINE_RE.test(lines[i]) &&
        !(HEADING_LINE_RE.test(lines[i]) && !lines[i].startsWith('###'))
      ) {
        textLines.push(lines[i])
        i++
      }
      // Blank lines split a run of text into separate paragraph segments.
      let chunk: string[] = []
      for (const l of textLines) {
        if (l === '') {
          if (chunk.length > 0) { segments.push({ type: 'text', lines: chunk }); chunk = [] }
        } else {
          chunk.push(l)
        }
      }
      if (chunk.length > 0) segments.push({ type: 'text', lines: chunk })
    }
  }
  return segments
}

// ── textToTiptapContent (used by edit-mode editor) ──

/** Convert plain-text body to Tiptap doc content for pre-populating the edit editor. */
export function textToTiptapContent(text: string) {
  const lines = text.split('\n')
  const docContent: Record<string, unknown>[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (HEADING_LINE_RE.test(line) && !line.startsWith('###')) {
      docContent.push({
        type: 'heading',
        attrs: { level: line.startsWith('##') ? 2 : 1 },
        content: parseInlineContent(line.replace(HEADING_LINE_RE, '')),
      })
      i++
      continue
    }

    if (/^[-•]\s/.test(line)) {
      const items: Record<string, unknown>[] = []
      while (i < lines.length && /^[-•]\s/.test(lines[i])) {
        const itemText = lines[i].replace(/^[-•]\s/, '')
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInlineContent(itemText) }],
        })
        i++
      }
      docContent.push({ type: 'bulletList', content: items })
      continue
    }

    if (/^\d+\.\s/.test(line)) {
      const items: Record<string, unknown>[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        const itemText = lines[i].replace(/^\d+\.\s/, '')
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInlineContent(itemText) }],
        })
        i++
      }
      docContent.push({ type: 'orderedList', content: items })
      continue
    }

    if (QUOTE_LINE_RE.test(line)) {
      const quoteParas: Record<string, unknown>[] = []
      while (i < lines.length && QUOTE_LINE_RE.test(lines[i])) {
        quoteParas.push({
          type: 'paragraph',
          content: parseInlineContent(lines[i].replace(QUOTE_LINE_RE, '')),
        })
        i++
      }
      docContent.push({ type: 'blockquote', content: quoteParas })
      continue
    }

    if (line.length === 0) {
      docContent.push({ type: 'paragraph', content: [] })
    } else {
      docContent.push({ type: 'paragraph', content: parseInlineContent(line) })
    }
    i++
  }

  return { type: 'doc' as const, content: docContent }
}

// ── serializeTiptapToText (whole-doc serializer for edit-mode submit) ──
//
// We type the editor structurally with `unknown` for the doc and use a small
// internal cast to keep the `forEach` access — Tiptap's real type involves
// generics that aren't worth importing here.

/** Serialize a full Tiptap editor doc to plain text. Skips resolutionBlock nodes
 *  (those are consumed by the resolve action, not part of the message body). */
export function serializeTiptapToText(editor: { state: { doc: unknown } } | null | undefined): string {
  if (!editor) return ''
  const doc = editor.state.doc as { forEach: (cb: (node: TiptapInlineChild & TiptapNode) => void) => void }
  const lines: string[] = []
  doc.forEach((node) => {
    if (node.type.name === 'resolutionBlock') return
    if (node.type.name === 'paragraph') {
      lines.push(serializeInline(node))
    } else if (node.type.name === 'heading') {
      const text = serializeInline(node)
      if (text.trim()) {
        const level = Number((node.attrs as Record<string, unknown>)?.level) === 2 ? 2 : 1
        lines.push(`${'#'.repeat(level)} ${text}`)
      }
    } else if (node.type.name === 'bulletList') {
      node.forEach((li) => {
        const liNode = li as TiptapInlineChild & TiptapNode
        liNode.forEach((liChild) => {
          if (liChild.type.name === 'paragraph') {
            lines.push(`- ${serializeInline(liChild as TiptapInlineChild & TiptapNode)}`)
          }
        })
      })
    } else if (node.type.name === 'orderedList') {
      let idx = 1
      node.forEach((li) => {
        const liNode = li as TiptapInlineChild & TiptapNode
        liNode.forEach((liChild) => {
          if (liChild.type.name === 'paragraph') {
            lines.push(`${idx}. ${serializeInline(liChild as TiptapInlineChild & TiptapNode)}`)
            idx++
          }
        })
      })
    } else if (node.type.name === 'blockquote') {
      node.forEach((qChild) => {
        if (qChild.type.name === 'paragraph') {
          lines.push(`> ${serializeInline(qChild as TiptapInlineChild & TiptapNode)}`)
        }
      })
    }
  })
  return lines.join('\n').trim()
}
