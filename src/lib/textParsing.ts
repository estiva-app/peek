import { PEOPLE } from '@/data/peopleData'
import { addrToNaddr, decodeNevent, decodeNpub, encodeNpub, referenceToPointer } from '@estiva-app/protocol'
import { personByPubkey } from '@/api/mentions'
import { findMessageByEventId } from '@/lib/conversationRegistry'
import { legacyTopicByChannel } from '@/lib/legacyTopicLinks'
import { TOPIC_KIND } from '@/nostr/manifest'
import { TOPICS } from '@/data/topicData'
import { DOCUMENT_FILES } from '@/data/filesData'
import { parseInlineMarks, stripInlineFormatting, wrapInlineMarks } from '@estiva-app/protocol'

// ── Mention regex ──
//
// Matches: @FullName / !@FullName (PEOPLE), @lowercase-handle (teams/groups
// like @backend-team, @devops), and [Topic Title] / [File Title] brackets.
// The lookahead (?![a-zA-Z/-]) prevents partial matches inside camelCase or
// package paths (e.g. @testing-library/react is left as plain text). The `-`
// in the carve-out is critical: without it, regex backtracking would let
// `@testing` match because the next char is `-` (a handle continuation char).
//
// A mention must also OPEN a word — see _wordStart. That fence used to be
// missing on the left, so `katerina@estiva.app` rendered with `@estiva` pulled
// out as a chip.
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
  ...DOCUMENT_FILES.map((f) => f.title),
]
  .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .sort((a, b) => b.length - a.length)
  .join('|')

/** The LEFT fence: a mention may only start a word, so an `@` sitting directly
 *  after a character an email address can contain never opens one. Without it
 *  `katerina@estiva.app` matched `@estiva` — the domain became a chip and the
 *  address was torn in half. The (?![a-zA-Z/-]) lookahead is the matching fence
 *  on the right, which is why package paths were already safe while every
 *  ordinary email was not.
 *
 *  `!` is deliberately NOT in the set: `!@` is the urgent form, and `wow!@devops`
 *  should still mention.
 *
 *  This mirrors the composer, where Tiptap's suggestion plugin already requires
 *  the `@` to follow a space or a line start (`allowedPrefixes: [' ']`) — which
 *  is why an email never opened the mention menu while typing, and only broke
 *  once the message was rendered. */
const _wordStart = '(?<![A-Za-z0-9._%+-])'

/**
 * A `nostr:` URI the editor loads back as a chip — SPEC §13.1's reference.
 * The same four forms `findNostrUris` reads, so what renders as a reference
 * in a body edits as one: a person (`npub`), a topic or any other addressable
 * object (`naddr`), a message (`nevent`, `note`).
 */
const _nostrUriPattern = 'nostr:(?:npub|naddr|nevent|note)1[023456789acdefghjklmnpqrstuvwxyz]+'

function _buildMentionRe(): RegExp {
  return new RegExp(
    // A `nostr:` URI first, so a key is recognised whole before any of the
    // name-shaped alternatives can match part of it. It is listed here rather
    // than parsed separately because this regex is what decides where a run of
    // plain text ends, and a key is not plain text.
    `(${_nostrUriPattern}|${_wordStart}(?:!@|@)(?:${_escapedNames()})|${_wordStart}@[a-z][a-z0-9-]+(?![a-zA-Z/-])|\\[(?:${_escapedBracketTitles})\\](?!\\())`,
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

/** Bare http(s) URL. Listed FIRST in the tokenizer so a URL is matched
 *  whole (greedily to the next whitespace) before an inner `@` or `[` can
 *  be mistaken for a mention. */
const _urlPattern = 'https?:\\/\\/[^\\s]+'

/**
 * `[label](url)` — SPEC §13.1's link mark, in marker text. PEE-19.
 *
 * Written and read here, in Peek, until `@estiva-app/protocol` speaks it
 * (PEE-25). The syntax is the spec's, not an invention, so this is an early
 * implementation of a specified construct rather than a private extension;
 * Ship shows the characters as they are until the package learns them, and
 * this code goes when it does. Only the schemes §13.1 lets a reader follow
 * (http, https, mailto — `nostr:` is a reference, not a link, in this app).
 * A label carries no bracket and no line break; a URL no whitespace and no
 * `)`.
 *
 * A bracket followed by `(` is a link and never a `[Topic]` chip — the chip
 * regexes above and below carry that lookahead, so a label that happens to
 * be a topic's title still links.
 */
const _linkPattern = '\\[[^\\[\\]\\n]+\\]\\((?:https?:\\/\\/|mailto:)[^\\s)]+\\)'
/** Splits a run around its links and keeps them — one capture group. */
const LINK_SPLIT_RE = new RegExp(`(${_linkPattern})`, 'g')
const LINK_WHOLE_RE = /^\[([^[\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)$/

/** A whole `[label](url)` token → its parts, or null. */
export function matchLink(part: string): { label: string; href: string } | null {
  const m = part.match(LINK_WHOLE_RE)
  return m ? { label: m[1], href: m[2] } : null
}

/**
 * Wrap a run of text as a link. Edge whitespace is hoisted outside the
 * brackets, as `wrapInlineMarks` does for the other markers, so linking
 * "word " round-trips as `[word](url) `. Nothing to wrap → the text as is.
 */
export function wrapLink(text: string, href: string): string {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)
  if (!m) return text
  const [, lead, core, trail] = m
  if (!core) return text
  return `${lead}[${core}](${href})${trail}`
}

/**
 * A link whose label is just its own address — PEE-22.
 *
 * Tiptap autolinks a bare URL the moment a body is loaded into the editor, so
 * **opening a message to edit one word turns every plain URL in it into a link
 * mark**, and writing that mark back as `[url](url)` rewrites text the person
 * never touched. Measured on the first edit ever published (2026-09-07): an
 * 89-character message became 196, and the URL was the only thing that changed
 * besides the sentence the person added.
 *
 * It matters beyond tidiness because the marker does not travel. The shared
 * inline vocabulary is four marks — bold, italic, underline, code — and **no
 * link**; `[label](url)` is SPEC §13.1's syntax and PEE-25 is the ticket to
 * implement it. Until then a reader outside Peek draws the brackets and
 * parentheses as literal characters, which is what Ship did.
 *
 * So when the label already *is* the address, the bare address is written. It
 * is the lossless case: a reader sees the URL, and loading it back autolinks it
 * to the same mark.
 *
 * **`defaultProtocol` counts as the same address.** Typing `google.com` gives a
 * label of `google.com` and an href of `https://google.com` — a completion
 * rather than a decision, and re-loading the bare label completes it the same
 * way. Anything else is a label somebody chose, and stays a link marker even
 * though no other app can draw it yet: dropping the href to avoid the brackets
 * would lose where the link goes, which is worse than showing them.
 */
function isBareAddress(label: string, href: string): boolean {
  const text = label.trim()
  if (!text) return false
  return text === href || `https://${text}` === href
}

/**
 * One text child of the editor → marker text. The link goes *inside* the
 * other markers — `**[label](url)**`, never `[**label**](url)` — because a
 * reader parses the marks first (the package does) and would cut a label
 * that carried them in two.
 */
export function serializeTextChild(child: TiptapInlineChild): string {
  const marks = child.marks ?? []
  const link = marks.find((m) => m.type.name === 'link')
  const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : undefined
  const text = child.text ?? ''
  const markNames = new Set(marks.filter((m) => m.type.name !== 'link').map((m) => m.type.name))
  const linked = href && !isBareAddress(text, href) ? wrapLink(text, href) : text
  return wrapInlineMarks(linked, markNames)
}

/**
 * A body as plain words for a preview line: marks stripped, a link reduced
 * to its label. The package strips what it knows; the link is Peek's until
 * PEE-25.
 */
export function previewText(body: string): string {
  return stripInlineFormatting(body).replace(LINK_SPLIT_RE, (token) => matchLink(token)?.label ?? token)
}

/** Tokenizer for read-only rendering: URLs, mentions and [refs].
 *  Single capture group so String.split() interleaves cleanly.
 *  Rebuilt alongside MENTION_RE when the workspace directory changes. */
function _buildInlineTokenRe(): RegExp {
  return new RegExp(
    `(${_linkPattern}|${_urlPattern}|${_wordStart}(?:!@|@)(?:${_escapedNames()})|${_wordStart}@[a-z][a-z0-9-]+(?![a-zA-Z/-])|\\[(?:${_escapedBracketTitles})\\](?!\\())`,
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

/**
 * Every http(s) URL in a body — the candidates for RFC 0.5 §7.5 matching.
 *
 * Deliberately not filtered by host. A consumer that only tried `estiva.app`
 * links would be hardcoding the ecosystem it belongs to, which is the whole
 * thing the projection layer exists not to do: the shapes come from published
 * manifests, so an app nobody here has heard of resolves on the same path.
 *
 * Cheap on purpose. Matching is a pure function against cached patterns, so a
 * body full of ordinary links costs no queries at all — only a URL some app
 * claims reaches the relay.
 */
export function findUrls(body: string): string[] {
  const out: string[] = []
  const add = (href: string) => {
    if (!out.includes(href)) out.push(href)
  }
  // A labelled link's target counts too, so the widget under a message does
  // not depend on how the link was written. Only http(s): a mailto: target
  // is nothing a manifest could claim.
  for (const token of body.match(LINK_SPLIT_RE) ?? []) {
    const link = matchLink(token)
    if (link && /^https?:/i.test(link.href)) add(link.href)
  }
  for (const part of body.replace(LINK_SPLIT_RE, ' ').split(/\s+/)) {
    const url = matchUrl(part)
    if (url) add(url.href)
  }
  return out
}

// ── Inline content parser ──

/** §13.1's shortened form of a URI, for a reference nothing here can name. */
function shortUri(uri: string): string {
  return `${uri.replace(/^nostr:/i, '').slice(0, 12)}…`
}

/**
 * The topic a `nostr:naddr…` names, when it is one of the old Convex topics —
 * with the address it was written as, so the chip serialises back to it.
 *
 * Read from the bundled table (FOL-26), not from Convex: the topics are gone
 * (FOL-23), and a mention of one written before then still loads back as the
 * chip it was picked from.
 */
function topicForAddress(uri: string): { id: string; title: string; address: string } | null {
  try {
    const pointer = referenceToPointer(uri)
    if (pointer.kind !== TOPIC_KIND || !pointer.identifier) return null
    const topic = legacyTopicByChannel(pointer.identifier)
    if (!topic) return null
    return { id: topic.id, title: topic.title, address: `${pointer.kind}:${pointer.pubkey}:${pointer.identifier}` }
  } catch {
    return null
  }
}

/** Parse a single line into Tiptap inline JSON nodes (text + mention nodes,
 *  with bold/italic/underline marks parsed from storage markers). */
export function parseInlineContent(line: string): Record<string, unknown>[] {
  const parts = line.split(MENTION_RE)
  const content: Record<string, unknown>[] = []
  for (const part of parts) {
    if (!part) continue
    if (/^nostr:npub1/i.test(part)) {
      /*
        A key, loaded back into the editor as the chip it was written as —
        SPEC §13.1. Without this an author who edits a message finds a wall of
        bech32 where a name used to be, which is a worse experience than the
        display-name form it replaced.

        The label is resolved *now*, from the directory as it stands. That is
        the point of storing the key: the name is a rendering of it rather than
        the thing itself, so a person who has since been renamed shows their
        current name here and in every message they were ever mentioned in.
      */
      let pubkey: string | null = null
      try {
        pubkey = decodeNpub(part)
      } catch {
        pubkey = null
      }
      const known = pubkey ? personByPubkey(pubkey) : undefined
      content.push({
        type: 'mention',
        attrs: {
          id: known?.id ?? pubkey ?? part,
          label: known?.name ?? shortUri(part),
          pubkey,
        },
      })
    } else if (/^nostr:naddr1/i.test(part)) {
      /*
        An address — an old topic's, when it is in the bundled table (RIC-11,
        FOL-23). `39000:<relay>:<uuid>` names a channel, so a topic mention
        loads back as the chip it was picked from, and the address is what the
        chip serialises to again.

        Any other address — another app's object, or a channel that was never a
        topic — stays as the text it was, and is written back as the same text.
        The editor has no chip that would say more than the URI does, and
        inventing one would put a label on an object it cannot name.
      */
      const topic = topicForAddress(part)
      if (topic) {
        content.push({
          type: 'topicMention',
          attrs: { id: topic.id, label: topic.title, isResolved: false, address: topic.address },
        })
      } else {
        content.push({ type: 'text', text: part })
      }
    } else if (/^nostr:(?:nevent|note)1/i.test(part)) {
      /*
        A message (RIC-11). Labelled from what is on screen when the message
        is, which is where a mention of one is almost always edited; otherwise
        the URI's own shortened form, the same "never blank" answer §13.1 gives
        a reader. The URI is kept whole on the node and written back verbatim,
        so editing a message never rewrites a mention it did not touch.
      */
      let eventId: string | null = null
      try {
        eventId = decodeNevent(part).id
      } catch {
        eventId = null
      }
      const message = eventId ? findMessageByEventId(eventId) : undefined
      content.push({
        type: 'messageMention',
        attrs: {
          id: eventId ?? part,
          label: message?.author ?? shortUri(part),
          snippet: message ? previewText(message.body) : '',
          uri: part,
        },
      })
    } else if (part.startsWith('!@') && part.length > 2) {
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
        const file = DOCUMENT_FILES.find((f) => f.title === title)
        content.push({
          type: 'fileMention',
          attrs: {
            id: file?.id ?? title,
            label: title,
            app: file?.docType ?? '',
            subtitle: file?.subtitle ?? '',
          },
        })
      }
    } else {
      for (const span of parseInlineMarks(part)) {
        const marks: Array<{ type: string; attrs?: Record<string, unknown> }> = []
        if (span.bold) marks.push({ type: 'bold' })
        if (span.italic) marks.push({ type: 'italic' })
        if (span.underline) marks.push({ type: 'underline' })
        // A link inside the span loads back as its label wearing the span's
        // own marks plus `link` — `**[label](url)**` is bold and linked. A
        // code span is literal (§13.1) and is not looked at.
        const pieces = span.code ? [span.text] : span.text.split(LINK_SPLIT_RE)
        for (const piece of pieces) {
          if (!piece) continue
          const link = matchLink(piece)
          const pieceMarks = link ? [...marks, { type: 'link', attrs: { href: link.href } }] : marks
          const text = link ? link.label : piece
          content.push(pieceMarks.length ? { type: 'text', text, marks: pieceMarks } : { type: 'text', text })
        }
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
  marks?: ReadonlyArray<{ type: { name: string }; attrs?: Record<string, unknown> }>
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
      // SPEC §13.1 — a key, when we have one. `label` is what a person typed
      // and reads well; it is also the thing that goes stale on a rename and
      // means nothing to another app, so it is the fallback rather than the
      // form. Somebody with no Estiva ID key still mentions by name, which is
      // exactly what every existing message already does.
      text += child.attrs.pubkey ? `nostr:${encodeNpub(child.attrs.pubkey)}` : `@${child.attrs.label}`
    } else if (child.type.name === 'urgentMention') {
      // The urgency is Peek's own affordance and has no wire form, so an
      // urgent mention of somebody with a key is still just a mention of them.
      text += child.attrs.pubkey ? `nostr:${encodeNpub(child.attrs.pubkey)}` : `!@${child.attrs.label}`
    } else if (child.type.name === 'topicMention') {
      /*
        SPEC §13.1 — the topic's address, when Peek can spell it (RIC-11).
        `39000:<relay>:<uuid>` is what another app resolves through Peek's
        manifest and what survives a rename; the bracketed title is what
        every message before this carried, and it stays the form for a topic
        with no address — a mock one, or a session that has not read the
        relay's key — exactly as a person with no key is still `@Name`.
      */
      text += child.attrs.address ? `nostr:${addrToNaddr(child.attrs.address, [])}` : `[${child.attrs.label}] `
    } else if (child.type.name === 'messageMention') {
      // Written back as the URI it was picked or loaded as, verbatim.
      text += child.attrs.uri
    } else if (child.type.name === 'fileMention') {
      text += `[${child.attrs.label}] `
    } else {
      text += serializeTextChild(child)
    }
  })
  return text
}

/** `# ` / `## ` at a line start. Shared with `textToTiptapContent` below;
 *  the block *parser* moved to `@estiva-app/protocol` but the edit-mode
 *  Tiptap builder is Peek's own and still reads the same prefixes. */
const HEADING_LINE_RE = /^#{1,2}\s/
/** `> ` with the space required — see the note on the package's copy. */
const QUOTE_LINE_RE = /^>\s/

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
