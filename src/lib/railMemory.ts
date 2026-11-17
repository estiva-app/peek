/**
 * Where each of the rail's items comes back to — the last DM, the last page
 * under Initiatives and under Teams, what Desk had open — kept in storage, so
 * a reload and a new tab keep it too (Katerina, 17 November: "when i switch
 * pages from the navrail, i need the selection to persist. no matter what";
 * "yes it should" for a new tab). Until then it was held in memory only, and
 * every reload — a refresh, the app updating, a dev server restarting — sent
 * each item back to its bare page.
 *
 * Kept twice: in this tab's storage and in the browser's. A reload reads the
 * tab's own, so two tabs open side by side each come back to their own place;
 * a new tab, which has none, reads the browser's, where the last tab to move
 * left it. Sign-out, or another person's copy on this device, clears both
 * (`deviceCopy`, before the app is drawn), so nobody is sent to a page of the
 * last person's.
 *
 * What is read back is checked: an app path (`/…`, never `//…`, which a
 * router would take for another site), a DM id, a Desk query. Anything else
 * is dropped, as if nothing were kept.
 */

/** What Desk had open, for coming back to it (Katerina, 5 October). */
export interface DeskMemory {
  search: string
  dm?: { dmId: string; dmName: string; section: string }
  openedFrom?: { section: string; title: string }
}

export interface RailMemory {
  dmId: string | null
  topicsPath: string | null
  foldersPath: string | null
  desk: DeskMemory | null
}

const KEY = 'peek.rail.last'

export const NO_RAIL_MEMORY: RailMemory = { dmId: null, topicsPath: null, foldersPath: null, desk: null }

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
const appPath = (value: unknown): string | null => (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : null)
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

function deskOf(value: unknown): DeskMemory | null {
  const desk = record(value)
  if (!desk || typeof desk.search !== 'string' || (desk.search !== '' && !desk.search.startsWith('?'))) return null
  const dm = record(desk.dm)
  const from = record(desk.openedFrom)
  const dmId = text(dm?.dmId)
  const section = text(from?.section)
  return {
    search: desk.search,
    ...(dm && dmId && typeof dm.dmName === 'string' && typeof dm.section === 'string' ? { dm: { dmId, dmName: dm.dmName, section: dm.section } } : {}),
    ...(from && section && typeof from.title === 'string' ? { openedFrom: { section, title: from.title } } : {}),
  }
}

/** What one storage kept, or nothing: never throws. */
function readFrom(storage: () => Storage): RailMemory | null {
  try {
    const kept = record(JSON.parse(storage().getItem(KEY) ?? 'null'))
    if (!kept) return null
    return { dmId: text(kept.dmId), topicsPath: appPath(kept.topicsPath), foldersPath: appPath(kept.foldersPath), desk: deskOf(kept.desk) }
  } catch {
    return null
  }
}

const tab = () => window.sessionStorage
const browser = () => window.localStorage

/** What this tab kept; in a new tab, what the browser kept last; else nothing. Never throws. */
export function readRailMemory(): RailMemory {
  return readFrom(tab) ?? readFrom(browser) ?? NO_RAIL_MEMORY
}

/** Keep where the rail's items come back to, for this tab and for the next one. Full or blocked storage keeps it for this visit only, as before. */
export function keepRailMemory(memory: RailMemory): void {
  const value = JSON.stringify(memory)
  for (const storage of [tab, browser]) {
    try {
      storage().setItem(KEY, value)
    } catch {
      // Nothing kept without storage.
    }
  }
}

/** Sign-out, or another person's copy on this device. */
export function clearRailMemory(): void {
  for (const storage of [tab, browser]) {
    try {
      storage().removeItem(KEY)
    } catch {
      // Nothing kept without storage.
    }
  }
}
