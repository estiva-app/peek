import { useEffect, useSyncExternalStore } from 'react'
import type { FileAttachment } from '@/api'

/**
 * Edits the relay refused, by the id of the message edited (OPT-8; decided by
 * Miky, 9 October). The message shows its old text again and its edit box
 * reopens holding what was saved — the text, the files, and why it was not
 * saved, said under the box — on the card when it is on screen, or when it is
 * next drawn, if the person has moved on by the time the relay answered. In
 * memory only: a reload loses it.
 */
export interface RefusedEdit {
  /** The text that was saved. */
  text: string
  /** Why, as the line under the box says it ("Not saved: …"). */
  reason: string
  /** The files the save carried, when it changed them; absent, the message's own. */
  files?: FileAttachment[]
}

const refused = new Map<string, RefusedEdit>()
const listeners = new Set<() => void>()
/** How many cards draw each message now: a refusal they will reopen needs no note. */
const drawn = new Map<string, number>()

/** The relay refused this edit of `id`: its card reopens with it. True when a card drawing the message is on screen. */
export function putBackEdit(id: string, edit: RefusedEdit): boolean {
  refused.set(id, edit)
  for (const listener of listeners) listener()
  return (drawn.get(id) ?? 0) > 0
}

/**
 * A card takes it to reopen its edit box with it. `false` when another card
 * drawing the same message took it first — a comment is drawn in its list and
 * at the top of its thread — so only one box reopens.
 */
export function takeRefusedEdit(id: string): boolean {
  if (!refused.delete(id)) return false
  for (const listener of listeners) listener()
  return true
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The refused edit of `id` waiting for its card, if any; the card calling it counts as drawing the message. */
export function useRefusedEdit(id: string | undefined): RefusedEdit | undefined {
  useEffect(() => {
    if (!id) return
    drawn.set(id, (drawn.get(id) ?? 0) + 1)
    return () => {
      const left = (drawn.get(id) ?? 1) - 1
      if (left > 0) drawn.set(id, left)
      else drawn.delete(id)
    }
  }, [id])
  return useSyncExternalStore(subscribe, () => (id ? refused.get(id) : undefined))
}
