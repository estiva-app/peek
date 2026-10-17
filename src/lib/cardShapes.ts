import type { LinkedKind, LoadingShape } from '@estiva-app/ui'

const STORAGE_KEY = 'peek.card-shapes'
const LIMIT = 300

/**
 * The card Peek draws for an issue it has not drawn on this device before: a
 * title and its pickers. The kit's own placeholder has room for a key line,
 * which Peek's issue card does not draw, and for a summary, which most issues
 * do not have, so it closed by 46 px as it drew (16 Oct).
 */
const FIRST_DRAW: Partial<Record<LinkedKind, LoadingShape>> = {
  issue: { subtitle: false, summary: false, footer: 'pickers' },
}

let held: Map<string, LoadingShape> | undefined

function shapes(): Map<string, LoadingShape> {
  if (held) return held
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    held = new Map(Array.isArray(stored) ? stored.filter((entry): entry is [string, LoadingShape] => Array.isArray(entry) && typeof entry[0] === 'string' && !!entry[1] && typeof entry[1] === 'object') : [])
  } catch {
    held = new Map()
  }
  return held
}

/**
 * The shape a chosen card took the last time this device drew it, so its
 * placeholder is the card's own height and the conversation does not move as
 * it loads; Peek's usual card for its kind before that. Kept like the
 * not-available memory beside it (`unavailableCards`), and cleared with the
 * rest of the device's copy (`deviceCopy`).
 */
export function cardShapeOf(reference: string, kind: LinkedKind): LoadingShape | undefined {
  return shapes().get(reference) ?? FIRST_DRAW[kind]
}

export function noteCardShape(reference: string, shape: LoadingShape): void {
  const current = shapes()
  if (JSON.stringify(current.get(reference)) === JSON.stringify(shape)) return
  const next = new Map(current)
  // Newest last, so the cap drops the cards drawn longest ago.
  next.delete(reference)
  next.set(reference, shape)
  held = new Map([...next].slice(-LIMIT))
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...held]))
  } catch {
    // Storage full or blocked: the shape is still held for this tab.
  }
}

export function clearCardShapes(): void {
  held = undefined
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing kept to clear.
  }
}
