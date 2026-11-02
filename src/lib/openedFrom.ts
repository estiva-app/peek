/** Peek's two list columns a file opens beside (TOP-4). */
export type ListColumnName = 'topics' | 'folders'

let last: { address: string; column: ListColumnName } | null = null

/**
 * A row was clicked in one of the list columns (TOP-4): the file's page shows
 * that column beside it. A row is a link the kit's router follows (ui 0.99),
 * so the click cannot hand the page anything but the URL; this is read once by
 * the page, which keeps it in its history entry so a reload keeps it too.
 */
export function rememberOpenedFrom(address: string, column: ListColumnName): void {
  last = { address, column }
}

/** The column a row for this file was last clicked in, if that is how it was opened. Pure: a render may ask twice. */
export function openedFrom(address: string): ListColumnName | undefined {
  return last?.address === address ? last.column : undefined
}

/** The page has kept it in its history entry: a later open of the same file some other way is not taken for a click. */
export function forgetOpenedFrom(address: string): void {
  if (last?.address === address) last = null
}
