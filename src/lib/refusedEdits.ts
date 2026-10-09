import { useSyncExternalStore } from 'react'

/**
 * Edits the relay refused, by the id of the message edited, with the text
 * that was saved (OPT-8; decided by Miky, 9 October). The message shows its
 * old text again and its edit box reopens holding this — on the card when it
 * is on screen, or when it is next drawn, if the person has moved on by the
 * time the relay answered. In memory only: a reload loses it.
 */
const refused = new Map<string, string>()
const listeners = new Set<() => void>()

/** The relay refused this edit of `id`: its card reopens with `text`. */
export function putBackEdit(id: string, text: string): void {
  refused.set(id, text)
  for (const listener of listeners) listener()
}

/** The card has reopened its edit box with it. */
export function takeRefusedEdit(id: string): void {
  if (refused.delete(id)) for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The refused edit of `id` waiting for its card, if any. */
export function useRefusedEdit(id: string | undefined): string | undefined {
  return useSyncExternalStore(subscribe, () => (id ? refused.get(id) : undefined))
}
