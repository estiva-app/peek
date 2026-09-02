import type { Editor } from '@tiptap/react'

/**
 * Tracks the composer the user most recently focused (or, failing that, the
 * last one mounted) so global surfaces like the command launcher can insert
 * content "into the compose box" without threading refs through the tree.
 */
export interface ComposerHandle {
  editor: Editor
  /** Attach Figma frames (by id) to this composer's attachment strip. */
  attachFrames: (frameIds: string[]) => void
  /** Where a launcher insert/attach lands, e.g. "Reply to Alice", "#Mobile rewrite". */
  label?: string
}

/** A snapshot of the active composer for context-aware surfaces (the command
 *  launcher). Its existence doubles as "a conversation surface is open". */
export interface ComposerTarget {
  label?: string
  isFocused: boolean
  hasDraft: boolean
}

let activeComposer: ComposerHandle | null = null

export function getComposerTarget(): ComposerTarget | null {
  if (!activeComposer || activeComposer.editor.isDestroyed) return null
  return {
    label: activeComposer.label,
    isFocused: activeComposer.editor.isFocused,
    hasDraft: activeComposer.editor.state.doc.textContent.trim().length > 0,
  }
}

export function registerActiveComposer(handle: ComposerHandle) {
  activeComposer = handle
}

export function unregisterComposer(editor: Editor) {
  if (activeComposer?.editor === editor) activeComposer = null
}

export interface FileMentionAttrs {
  id: string
  label: string
  app: string
  subtitle: string
}

/** Insert a file-reference chip (plus a trailing space) at the active
 *  composer's cursor. Returns false when no composer is available. */
export function insertFileMentionIntoActiveComposer(attrs: FileMentionAttrs): boolean {
  if (!activeComposer || activeComposer.editor.isDestroyed) return false
  activeComposer.editor
    .chain()
    .focus()
    .insertContent([
      { type: 'fileMention', attrs },
      { type: 'text', text: ' ' },
    ])
    .run()
  return true
}

/**
 * Insert a `nostr:` object reference (plus a trailing space) at the active
 * composer's cursor. Returns false when no composer is available.
 *
 * **The reference goes in the composer rather than in a message of its own
 * (PEE-2).** Creating an issue from a conversation has to leave a trace, or the
 * capture solves the typing and not the knowing — but the trace goes out in the
 * person's words, on their send, so nothing is ever published in their voice.
 * They can add "@Katerina can you take this?" to the same message.
 *
 * Sent, `MessageBody` finds the `nostr:naddr1…` back out of the body
 * (`findNaddrs`), drops it from the prose (`stripNaddrs`) and renders the
 * object through its own projection. So the *spelling* is the contract here,
 * not the node type: this must stay plain text matching `NADDR_RE`.
 *
 * Marks are cleared first. The cursor may sit inside a bold or code run, and an
 * inherited mark serialises to marker characters around the reference — which
 * `stripNaddrs` then leaves behind as `**` once the reference itself is taken
 * out of the prose.
 */
export function insertReferenceIntoActiveComposer(naddr: string): boolean {
  if (!activeComposer || activeComposer.editor.isDestroyed) return false
  activeComposer.editor
    .chain()
    .focus()
    .unsetAllMarks()
    .insertContent([{ type: 'text', text: `nostr:${naddr} ` }])
    .run()
  return true
}

/** Attach Figma frames to the active composer's attachment strip (previews
 *  below the text, carried on send). Returns false when no composer exists. */
export function attachFramesToActiveComposer(frameIds: string[]): boolean {
  if (!activeComposer || activeComposer.editor.isDestroyed) return false
  activeComposer.attachFrames(frameIds)
  activeComposer.editor.chain().focus().run()
  return true
}
