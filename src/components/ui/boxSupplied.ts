import { createContext } from 'react'
import type { ForeignObject } from '@estiva-app/interop'
import { valueOfReference } from '@/lib/embedValue'

/** What a box's seam already holds, for a surface with no relay to ask (a story, a test), by reference or address. */
export const BoxSupplied = createContext<Record<string, ForeignObject> | undefined>(undefined)

/** What the seam holds for `uri`, by the file, not the spelling: a seam's `naddr` may carry relay hints the box's does not. */
export function suppliedFor(supplied: Record<string, ForeignObject> | undefined, uri: string): ForeignObject | undefined {
  if (!supplied) return undefined
  const value = valueOfReference(uri.startsWith('nostr:') ? uri : `nostr:${uri}`)
  return Object.entries(supplied).find(([key]) => valueOfReference(key.startsWith('nostr:') ? key : `nostr:${key}`) === value)?.[1]
}
