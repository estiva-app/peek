import type { Editor } from '@tiptap/react'

/**
 * The formats the `/` menu offers — PEE-18.
 *
 * **The hint is Peek's own trigger, not Tiptap's key chord.** Every one of
 * these also has a `Mod-…` binding, but the trigger is what this app teaches:
 * the Shortcuts section beside it shows `@`, `!@`, `[` and `->`, so a column of
 * `Ctrl+Alt+1` next to them would be a different language in the same menu.
 *
 * Each trigger is the input rule the installed extension actually registers,
 * read out of its source rather than from documentation:
 *
 * | format        | rule                          | from                 |
 * | ------------- | ----------------------------- | -------------------- |
 * | Heading       | `^(#{1,2})\s$`                | extension-heading    |
 * | Subheading    | same rule, two hashes         | extension-heading    |
 * | Quote         | `^\s*>\s$`                    | extension-blockquote |
 * | Bulleted list | `^\s*([-+*])\s$`              | extension-list       |
 * | Numbered list | `^(\d+)\.\s$`                 | extension-list       |
 * | Code          | ``(^|[^`])`([^`]+)`(?!`)$``   | extension-code       |
 *
 * `Text` has no trigger — there is no input rule that turns a block back into
 * a paragraph — so its hint is blank rather than invented.
 *
 * **Why `taskList` is absent** even though StarterKit registers it:
 * `serializeToText` in `ComposeBox` walks `bulletList` and `orderedList` and
 * nothing else, so a task list would be dropped on send. The schema probe
 * confirms it is not in the composer's node set either.
 *
 * **Why bold, italic and underline are absent:** they apply to text you have
 * already written, so they live in the selection toolbar. Code is here as well
 * as there because a fenced run is something you often decide on before typing
 * it.
 */
export type FormatId = 'paragraph' | 'heading' | 'subheading' | 'quote' | 'bulletList' | 'orderedList' | 'code'

export interface FormatDef {
  id: FormatId
  label: string
  /** What you type in the composer to get it. Blank when there is no such rule. */
  trigger?: string
}

export const FORMATS: readonly FormatDef[] = [
  { id: 'paragraph', label: 'Text' },
  { id: 'heading', label: 'Heading', trigger: '#' },
  { id: 'subheading', label: 'Subheading', trigger: '##' },
  { id: 'quote', label: 'Quote', trigger: '>' },
  { id: 'code', label: 'Code', trigger: '`' },
  { id: 'bulletList', label: 'Bulleted list', trigger: '-' },
  { id: 'orderedList', label: 'Numbered list', trigger: '1.' },
]

/**
 * Apply one format to the current block.
 *
 * `set*` rather than `toggle*` wherever Tiptap offers it: choosing "Heading"
 * from a list should make the line a heading, not turn one off. Quote, the
 * lists and code have no `set` form, and the distinction cannot bite here —
 * the menu only opens on an empty single-block composer, where toggling on and
 * setting are the same move.
 *
 * Returns what Tiptap's chain returned. `false` means *nothing changed*, not
 * that anything failed — choosing Text inside a paragraph is a legitimate
 * no-op. Judge the outcome by the block the caret ends up in, which is what
 * the tests do.
 */
export function applyFormat(editor: Editor, id: FormatId): boolean {
  const chain = editor.chain().focus()
  switch (id) {
    case 'paragraph':
      return chain.setParagraph().run()
    case 'heading':
      return chain.setHeading({ level: 1 }).run()
    case 'subheading':
      return chain.setHeading({ level: 2 }).run()
    case 'quote':
      return chain.toggleBlockquote().run()
    case 'bulletList':
      return chain.toggleBulletList().run()
    case 'orderedList':
      return chain.toggleOrderedList().run()
    case 'code':
      return chain.toggleCode().run()
    default:
      return false
  }
}

/**
 * The marks the selection toolbar toggles — SelectionToolbar.
 *
 * Only these three. Code is a mark too, but it belongs to the `/` menu (see
 * above) and putting it in both places would make the toolbar four buttons
 * wide for a mark nobody reaches for mid-sentence.
 *
 * All three are in the composer's schema — verified against `peekStarterKit`,
 * which resolves to marks `link, bold, code, italic, underline`.
 */
export type MarkId = 'bold' | 'italic' | 'underline'

export interface MarkDef {
  id: MarkId
  label: string
  /** The keyboard binding, shown in the tooltip. `Mod` renders per platform. */
  keys: string
}

export const MARKS: readonly MarkDef[] = [
  { id: 'bold', label: 'Bold', keys: 'Mod-B' },
  { id: 'italic', label: 'Italic', keys: 'Mod-I' },
  { id: 'underline', label: 'Underline', keys: 'Mod-U' },
]

/** Toggle one mark over the current selection. */
export function toggleMark(editor: Editor, id: MarkId): boolean {
  const chain = editor.chain().focus()
  switch (id) {
    case 'bold':
      return chain.toggleBold().run()
    case 'italic':
      return chain.toggleItalic().run()
    case 'underline':
      return chain.toggleUnderline().run()
    default:
      return false
  }
}

/**
 * Links — PEE-19.
 *
 * The selection toolbar's fourth button, and the field it opens. Two ways in
 * (Katerina, 2026-09-07, after Linear): press Link with words selected and
 * type the address; or paste an address over selected words, which Tiptap's
 * Link extension already turns into a link. Select linked words again and the
 * field opens with their address in it. Cmd/Ctrl+K is out of scope: it is the
 * launcher everywhere in Peek.
 *
 * Removal is the empty field — clear the address and press Enter. There is no
 * delete button, by her call; the field is the whole control.
 */

/** The address the selection sits in, or '' — what the field opens with. */
export function currentLink(editor: Editor): string {
  const href: unknown = editor.getAttributes('link').href
  return typeof href === 'string' ? href : ''
}

/**
 * What somebody typed into the field → an `href`, or null when it cannot be one.
 *
 * A bare host (`google.com`) gets `https://`, as Linear and the typed-URL
 * rule do. A scheme is kept only when SPEC §13.1 lets a reader follow it
 * (http, https, mailto); anything else — `javascript:`, `ftp:` — is refused
 * here rather than sent for a reader to render as text. `localhost:5173` is a
 * host and a port, not a scheme: a scheme is never followed by a digit.
 */
export function normalizeHref(raw: string): string | null {
  const s = raw.trim()
  if (!s || /\s/.test(s)) return null
  if (/^(https?:|mailto:)/i.test(s)) return s
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(s)) return null
  return `https://${s}`
}

/**
 * Apply the field to the selection. Empty removes the link; an address sets
 * it, over the whole link when the caret sits inside one. `false` means the
 * text could not be an address, and the field should stay open.
 */
export function applyLink(editor: Editor, raw: string): boolean {
  const chain = editor.chain().focus().extendMarkRange('link')
  if (!raw.trim()) return chain.unsetLink().run()
  const href = normalizeHref(raw)
  if (!href) return false
  return chain.setLink({ href }).run()
}

/**
 * Re-exported so the composer keeps one import. The definition moved to
 * `@/lib/shortcuts` (2026-09-05) when the top bar and the launcher needed it
 * too — three surfaces naming a key three ways is how `⌘` ended up hardcoded
 * in two of them.
 */
export { isApplePlatform, shortcutLabel } from './shortcuts'
