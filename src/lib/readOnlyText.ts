/**
 * A Leaf document — protocol 0.34's `KIND.DOCUMENT`.
 *
 * A local number until Peek takes protocol 0.34, which it takes together with
 * `@estiva-app/ui` 0.68: protocol 0.33 changed what a reference node must
 * declare, and ui 0.67's editor does not, so taking the protocol alone turns a
 * URL in a Ship description into an empty reference on save.
 */
export const KIND_DOCUMENT = 30842

