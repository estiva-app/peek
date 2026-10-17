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

const FOOTERS: readonly unknown[] = ['pickers', 'people', 'line', 'none']

/** A stored shape read back, only the parts a placeholder draws; anything else stored there is dropped. */
function storedShape(value: unknown): LoadingShape | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { subtitle, summary, rows, latest, ring, footer } = value as Record<string, unknown>
  return {
    subtitle: subtitle === true,
    summary: summary === true,
    // A project card lists at most a few of its issues; a bad number must not draw a page of bars.
    rows: typeof rows === 'number' && Number.isInteger(rows) ? Math.min(Math.max(rows, 0), 10) : 0,
    latest: latest === true,
    ring: ring === true,
    footer: FOOTERS.includes(footer) ? (footer as LoadingShape['footer']) : 'line',
  }
}

/**
 * A card's shape, and the height it drew at in px. The height is what holds a
 * summary of two lines: the kit clamps a summary to two, and its placeholder
 * has room for one (17 Oct, 114 → 134 px on production).
 */
export type CardShape = LoadingShape & { height?: number }

function storedCardShape(value: unknown): CardShape | undefined {
  const shape = storedShape(value)
  const height = (value as { height?: unknown } | undefined)?.height
  return shape && typeof height === 'number' && height > 0 && height < 2000 ? { ...shape, height: Math.round(height) } : shape
}

let held: Map<string, CardShape> | undefined

function shapes(): Map<string, CardShape> {
  if (held) return held
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    held = new Map()
    for (const entry of Array.isArray(stored) ? stored : []) {
      const shape = Array.isArray(entry) && typeof entry[0] === 'string' ? storedCardShape(entry[1]) : undefined
      if (shape) held.set(entry[0] as string, shape)
    }
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
export function cardShapeOf(reference: string, kind: LinkedKind): CardShape | undefined {
  return shapes().get(reference) ?? FIRST_DRAW[kind]
}

export function noteCardShape(reference: string, shape: CardShape): void {
  const current = shapes()
  // Already the card drawn last, as it is now: nothing to move or write.
  if ([...current.keys()].at(-1) === reference && JSON.stringify(current.get(reference)) === JSON.stringify(shape)) return
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
