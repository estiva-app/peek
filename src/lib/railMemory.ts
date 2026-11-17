/**
 * Where each of the rail's items comes back to — the last DM, the last page
 * under Initiatives and under Teams, what Desk had open — kept in this tab's
 * storage, so a reload keeps it too (Katerina, 17 November: "when i switch
 * pages from the navrail, i need the selection to persist. no matter what").
 * Until then it was held in memory only, and every reload — a refresh, the
 * app updating, a dev server restarting — sent each item back to its bare
 * page.
 *
 * This tab's, not the browser's: two tabs each keep their own place, as the
 * kit's `ListColumn` keeps its scroll per tab (`rememberAs`). A new tab starts
 * from each item's own page. Sign-out, or another person's copy on this
 * device, clears it (`deviceCopy`), so nobody is sent to a page of the last
 * person's.
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

/** What this tab kept, or nothing: never throws. */
export function readRailMemory(): RailMemory {
  try {
    const kept = record(JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null'))
    if (!kept) return NO_RAIL_MEMORY
    return { dmId: text(kept.dmId), topicsPath: appPath(kept.topicsPath), foldersPath: appPath(kept.foldersPath), desk: deskOf(kept.desk) }
  } catch {
    return NO_RAIL_MEMORY
  }
}

/** Keep where the rail's items come back to. Full or blocked storage keeps it for this visit only, as before. */
export function keepRailMemory(memory: RailMemory): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(memory))
  } catch {
    // Nothing kept without storage.
  }
}

/** Sign-out, or another person's copy on this device. */
export function clearRailMemory(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // Nothing kept without storage.
  }
}
