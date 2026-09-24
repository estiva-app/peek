/**
 * DM directory — which DM conversations exist and who they're with.
 *
 * A DM is identified by **the partner's pubkey** (`dmId`, REM-3), never by a
 * conversation number. That key is the same for every viewer and every app, so
 * two people addressing each other always land on the same conversation; the
 * relay resolves the pair to one channel (domain model §2.4). The previous
 * scheme minted client-side numbers from the viewer's People-list position,
 * which collided across viewers.
 *
 * This directory is the **mock** cast's, keyed by its own ids.
 *
 * The old numeric ids survive only as the mock fixture's storage keys
 * (`DM_CONVERSATIONS` is keyed by them); `mockConvIdFor` bridges to them in
 * mock mode. Nothing outside the seam should see them.
 */

export interface DmDirectoryEntry {
  /** The partner's person key — the DM's stable id. */
  dmId: string
  /** Storage key of the seeded mock conversation (mock mode only). */
  mockConvId: number
  name: string
}

export const DM_DIRECTORY: DmDirectoryEntry[] = [
  { dmId: 'alice',  mockConvId: 1, name: 'Alice Johnson' },
  { dmId: 'daniel', mockConvId: 2, name: 'Daniel Stanton' },
  { dmId: 'hallie', mockConvId: 3, name: 'Hallie Pratt' },
  { dmId: 'greg',   mockConvId: 4, name: 'Greg Bothman' },
  { dmId: 'juan',   mockConvId: 5, name: 'Juan Foley' },
  { dmId: 'amie',   mockConvId: 6, name: 'Amie Miles' },
  { dmId: 'zack',   mockConvId: 7, name: 'Zack Bright' },
]

export function dmNameById(dmId: string): string | undefined {
  return DM_DIRECTORY.find((d) => d.dmId === dmId)?.name
}

/** Seam-internal: the mock fixture's storage key for a DM, if it has one. */
export function mockConvIdFor(dmId: string): number | undefined {
  return DM_DIRECTORY.find((d) => d.dmId === dmId)?.mockConvId
}
