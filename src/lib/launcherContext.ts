import { getComposerTarget, type ComposerTarget } from './composerRegistry'
import { getActiveConversation, type ConversationSnapshot } from './conversationRegistry'

/**
 * What the user was doing at the moment they invoked the command launcher.
 * Captured once at the Cmd/Ctrl+K keystroke (or toolbar click) and passed
 * into the launcher, which FILTERS its actions by it - an action appears
 * only where it can succeed; the context that enables an action is
 * responsible for advertising it.
 */
export interface LauncherContext {
  /** Non-empty text selected inside a compose box (draft text only -
   *  selections on sent messages are deliberately not a context). */
  selection?: { text: string }
  /** The composer a launcher insert/attach would land in (last touched).
   *  Present iff a conversation surface is open. */
  composer?: ComposerTarget
  /** The objects the open thread already refers to — the target list for a
   *  field-setting action (PEE-3). Absent when no thread is open. */
  conversation?: ConversationSnapshot
}

export function captureLauncherContext(): LauncherContext {
  return {
    selection: captureComposerSelection(),
    composer: getComposerTarget() ?? undefined,
    conversation: getActiveConversation() ?? undefined,
  }
}

/** The current text selection, but only when it lives inside a compose box
 *  (tagged with data-composer-editor). */
export function captureComposerSelection(): { text: string } | undefined {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return undefined
  const text = sel.toString().trim()
  if (!text) return undefined
  const anchor = sel.anchorNode
  const el = anchor instanceof Element ? anchor : anchor?.parentElement
  if (!el?.closest('[data-composer-editor]')) return undefined
  return { text }
}
