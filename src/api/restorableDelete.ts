import { FILE_KINDS } from '@estiva-app/protocol'

/**
 * Whether deleting the file at `address` only marks it, so it can be brought back from Archive → Deleted (SPEC §6.5):
 * every file is kept in order, and its Delete is its `deleted` change. Anything else is still deleted for good.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/every-file-type-is-kept-in-order-and-a-delete-only-marks-the-file.md
 */
export function isRestorableDelete(address: string): boolean {
  return FILE_KINDS.includes(Number(address.split(':')[0]))
}
