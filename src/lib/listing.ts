/**
 * A team's list names a file by its address (an `a` entry) or by its id (an
 * `o` entry, SPEC §3.3). A move writes the id once the relay keeps the file in
 * order, so a file moved since then is listed by its id alone (SHI-64). These
 * are interop's `identifierOf` and `listsFile`, which its package does not export.
 */
export interface Listing {
  addresses?: readonly string[]
  ids?: readonly string[]
}

/** A file's id from its full address (`kind:author:id`); none for anything else. */
export function idOfAddress(address: string): string | undefined {
  return /^\d+:[0-9a-f]{64}:([^]*)$/.exec(address)?.[1]
}

/** Whether a team's list names the file at `address`, by its address or by its id. */
export function listsFile(folder: Listing, address: string): boolean {
  if (folder.addresses?.includes(address)) return true
  const id = idOfAddress(address)
  return id !== undefined && !!folder.ids?.includes(id)
}
