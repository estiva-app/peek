import { KIND_BARE_FILE, type ForeignObject } from '@estiva-app/interop'

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
 * The kinds whose text Peek shows and never edits: a bare file (a page or a
 * topic, `30840`) and a Leaf document (`30842`).
 *
 * > **Miky, 2026-10-14** — *"You should not be able to edit Leaf document (the
 * > description) in Peek. In Peek you can comment. You should see the card so
 * > you can open it easily in Leaf."*
 *
 * The same call was made for a bare file a day earlier (Leaf 1, Miky
 * 2026-10-13): interop declares `describe` on every `30840`, and Leaf's
 * manifest declares it on every `30842`, so honouring the declaration would
 * make the text editable from a message card by anyone in the Folder, last
 * save wins. People edit that text in Leaf; Peek shows it, links to it and
 * carries its conversation.
 *
 * Only the text. A rename, a move, an archive or a delete is still offered
 * where Peek offers them for any file, and a Ship issue's or project's
 * description keeps its editor (MAN-9).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-document-is-its-own-type-of-file.md
 */
const READ_ONLY_TEXT_KINDS: ReadonlySet<number> = new Set([KIND_BARE_FILE, KIND_DOCUMENT])

/**
 * The field a bare file's and a Leaf document's text is folded from (a
 * `kind:1851` `description`) — what their `describe` sets. Matched as well as
 * the body slot's field, because interop drops an empty body slot.
 */
export const TEXT_FIELD = 'description'

/** Whether Peek may draw an editor over this object's text (its body). */
export function peekEditsTextOf(object: Pick<ForeignObject, 'kind'>): boolean {
  return !READ_ONLY_TEXT_KINDS.has(object.kind)
}
