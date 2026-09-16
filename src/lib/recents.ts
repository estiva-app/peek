import { useSyncExternalStore } from 'react'

/**
 * The topics and people this browser opened last — the launcher's Recent group
 * (Katerina, 16 September, C3: "yes, and they can be cleared").
 *
 * Peek had nothing like it: `lastSelection` remembers one topic and one person
 * for the rail's links, in memory, and forgets both on a refresh. A launcher
 * offers recents so that the place you were a minute ago is one keystroke away,
 * which is only true if the list outlives the page — so this is localStorage.
 *
 * **It is the person's own history, and theirs to edit**: the launcher forgets
 * one with Ctrl+Backspace and clears them all with a row. Written when a topic
 * or a person is opened (`TopicsPage`, `PeoplePage`), by id only — the titles
 * and names are read from the live lists when the launcher draws them, so a
 * rename shows and a topic nobody can reach any more simply drops out.
 */

export interface Recent {
  kind: 'topic' | 'person'
  id: string
}

const KEY = 'estiva-peek:recents'
/** More than the launcher shows, so a forgotten or unreachable one leaves a next one behind it. */
const KEEP = 20

let cache: Recent[] | null = null
const listeners = new Set<() => void>()

function read(): Recent[] {
  if (cache) return cache
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]')
    cache = Array.isArray(parsed)
      ? parsed.filter((r): r is Recent => (r?.kind === 'topic' || r?.kind === 'person') && typeof r?.id === 'string')
      : []
  } catch {
    cache = []
  }
  return cache
}

function write(next: Recent[]) {
  cache = next
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage refused (a private window, a full quota): the list still works
    // for this page, and simply starts empty next time.
  }
  for (const listener of listeners) listener()
}

const same = (a: Recent, b: Recent) => a.kind === b.kind && a.id === b.id

/** Put this one first. Opening it again moves it up rather than listing it twice. */
export function rememberRecent(recent: Recent) {
  const current = read()
  if (current[0] && same(current[0], recent)) return
  write([recent, ...current.filter((r) => !same(r, recent))].slice(0, KEEP))
}

export function forgetRecent(recent: Recent) {
  write(read().filter((r) => !same(r, recent)))
}

export function clearRecents() {
  write([])
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab of Peek changed the list: read it again.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    cache = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** The list, newest first, kept current as it changes here or in another tab. */
export function useRecents(): Recent[] {
  return useSyncExternalStore(subscribe, read, () => [])
}

/** For tests: drop what is held in memory, so the next read comes from storage. */
export function resetRecentsForTests() {
  cache = null
}
