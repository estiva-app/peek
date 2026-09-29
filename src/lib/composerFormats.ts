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

/*
 * The selection toolbar's marks and its link field — `MARKS`, `toggleMark`,
 * `currentLink`, `normalizeHref`, `applyLink` — and the words-not-glyphs key
 * names moved into estiva-ui with the toolbar (UIG-31, 0.45.0): the toolbar,
 * `normalizeHref` and `KeptSelection` from `@estiva-app/ui/editor`,
 * `shortcutLabel` and `isApplePlatform` from `@estiva-app/ui`.
 */
