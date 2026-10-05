/**
 * The formats the `/` menu offers — PEE-18. The package's since CON-27
 * (estiva-ui 0.52.0, `FORMATS` and `applyFormat` beside `formatSection`); Peek
 * takes code inline, the default (Katerina, 29 Sep).
 *
 * **The hint is Peek's own trigger, not Tiptap's key chord.** Every one of
 * these also has a `Mod-…` binding, but the trigger is what this app teaches:
 * the Insert rows beside it show `@`, `!@`, `[` and `->`.
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
 * **Why `taskList` is absent** even though StarterKit registers it:
 * `serializeToText` in `ComposeBox` walks `bulletList` and `orderedList` and
 * nothing else, so a task list would be dropped on send.
 *
 * The selection toolbar's marks and its link field moved into estiva-ui with
 * the toolbar (UIG-31, 0.45.0): the toolbar, `normalizeHref` and
 * `KeptSelection` from `@estiva-app/ui/editor`, `shortcutLabel` and
 * `isApplePlatform` from `@estiva-app/ui`.
 */
export { FORMATS, applyFormat, type FormatDef, type FormatId } from '@estiva-app/ui/editor'
