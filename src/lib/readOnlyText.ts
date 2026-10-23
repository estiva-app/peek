/**
 * A Leaf document — protocol 0.34's `KIND.DOCUMENT`.
 *
 * A local number until Peek takes protocol 0.34, which it takes together with
 * `@estiva-app/ui` 0.68: protocol 0.33 changed what a reference node must
 * declare, and ui 0.67's editor does not, so taking the protocol alone turns a
 * URL in a Ship description into an empty reference on save.
 */
export const KIND_DOCUMENT = 30842

/**
 * The field a file's text is folded from (a `kind:1851` `description`) — what
 * a `describe` sets. Matched as well as the body slot's field, because interop
 * drops an empty body slot.
 *
 * Peek shows every file's text and never edits it: a bare file's and a Leaf
 * document's are written in Leaf (Miky, 2026-10-13 and 2026-10-14: *"In Peek
 * you can comment. You should see the card so you can open it easily in
 * Leaf."*), and a Ship issue's or project's in Ship or Leaf (Miky,
 * 2026-10-23: "Peek and Ship do not offer an editor on a document or on each
 * other's files").
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-card-changes-what-a-files-app-shares.md
 */
export const TEXT_FIELD = 'description'
