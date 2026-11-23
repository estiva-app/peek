import type { Editor } from '@tiptap/react'

/**
 * Tracks the composer the user most recently focused (or, failing that, the
 * last one mounted) so global surfaces like the command launcher can insert
 * content "into the compose box" without threading refs through the tree.
 */
export interface ComposerHandle {
  editor: Editor
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

/** Text waiting for a composer that is not on screen yet (`insertTextWhenComposerOpens`). */
const waiting = new Set<(handle: ComposerHandle) => void>()

export function registerActiveComposer(handle: ComposerHandle) {
  activeComposer = handle
  for (const tell of [...waiting]) tell(handle)
}

/**
 * Put text in a composer that is about to open: the one labelled `label`, in a
 * conversation Peek is on its way to (KIN-2: an answer goes into the
 * conversation it is about, not the one on screen when it is picked).
 *
 * Only a composer that registers **after** this call counts, and only one
 * carrying the label, so the text cannot land in the box that happens to be
 * active while the page is still changing: a reply about one conversation in
 * another's message box is the mistake this is for. If none arrives within
 * `deadlineMs` it answers `false` and nothing was written.
 */
export function insertTextWhenComposerOpens(label: string | undefined, text: string, deadlineMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const before = activeComposer?.editor
    const tell = (handle: ComposerHandle) => {
      if (handle.editor === before || handle.label !== label) return
      done(insertTextIntoActiveComposer(text))
    }
    const timer = setTimeout(() => done(false), deadlineMs)
    const done = (placed: boolean) => {
      clearTimeout(timer)
      waiting.delete(tell)
      resolve(placed)
    }
    waiting.add(tell)
  })
}

export function unregisterComposer(editor: Editor) {
  if (activeComposer?.editor === editor) activeComposer = null
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
 * (`findNaddrs`) and renders the object through its own projection. So the
 * *spelling* is the contract here: what is sent must be the address matching
 * `NADDR_RE`. It goes in as the comment box's `reference` chip (UIG-40, PEEKM-3) —
 * the sent message's chip, title and status (Katerina, 28 September) — which
 * `composerText` writes back as exactly that address.
 *
 * **It is drawn in place wherever the cursor was, since OPT-18**: the kit's
 * chip, its key, title and status, as the whole message or after "Filed it —"
 * alike. The card under the box is the box's own: the one file a message names
 * gets it, and ✕ takes it off (SPEC §13.6.2); this function only writes the
 * pointer.
 *
 * Marks are cleared first. The cursor may sit inside a bold or code run, and an
 * inherited mark serialises to marker characters around the reference, which
 * used to be left behind as a dangling `**` when the reference between them was
 * taken out of the prose. The reference stays now, but a bolded pointer is
 * still not what anybody typed.
 */
export function insertReferenceIntoActiveComposer(naddr: string): boolean {
  if (!activeComposer || activeComposer.editor.isDestroyed) return false
  activeComposer.editor
    .chain()
    .focus()
    .unsetAllMarks()
    .insertContent([
      { type: 'reference', attrs: { uri: `nostr:${naddr}` } },
      { type: 'text', text: ' ' },
    ])
    .run()
  return true
}

/**
 * Put a drafted reply at the composer's cursor (INT-4).
 *
 * **At the cursor, never replacing.** A person may already have typed
 * something, and a draft that overwrote it would be the whole-form version of
 * the mistake PEE-6 avoided per field: overwriting what somebody wrote is
 * unacceptable, and inserting is the non-destructive move that needs no rule.
 *
 * It does not send. That is INT-4's central promise and it is the same one
 * PEE-2 settled for a different payload: the text goes out in the person's
 * words, on their send, and nothing is ever published in their voice.
 *
 * Marks are cleared first, for the reason `insertReferenceIntoActiveComposer`
 * gives: a cursor inside a bold run would otherwise wrap the whole draft.
 */
export function insertTextIntoActiveComposer(text: string): boolean {
  if (!activeComposer || activeComposer.editor.isDestroyed) return false
  const trimmed = text.trim()
  if (!trimmed) return false
  /*
    Newlines become hard breaks rather than paragraphs. A drafted reply is one
    message, and splitting it into paragraph nodes would change what the
    composer serialises on send.
  */
  const content = trimmed.split(/\n+/).flatMap((line, i) =>
    i === 0 ? [{ type: 'text', text: line }] : [{ type: 'hardBreak' }, { type: 'text', text: line }],
  )
  activeComposer.editor.chain().focus().unsetAllMarks().insertContent(content).run()
  return true
}

