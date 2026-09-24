import type { ForeignObject } from '@estiva-app/interop'

/*
  A DM or a file. The third kind, a Convex topic, went with the Convex topics
  in FOL-23: its row carried a Convex id that nothing can resolve any more.
*/
export type OpenWorkItem =
  | {
      id: string
      kind: 'dm'
      dmId: string
      name: string
      avatarSrc?: string
      isUnread?: boolean
    }
  | {
      id: string
      /** A file on the relay — a bare-file topic, a Ship issue (FOL-34). */
      kind: 'file'
      /** `kind:pubkey:d`, the file's identity; it has no Convex id. */
      address: string
      title: string
      /** The resolved file, for the unread badge (`useConversationBadges`). */
      object: ForeignObject
    }

export type UrgentItem = {
  id: string
  kind: 'dm'
  dmId: string
  name: string
  avatarSrc?: string
}

export type StarredEntry = {
  id: string
  kind: 'dm'
  dmId: string
  name: string
  avatarSrc?: string
  isUnread?: boolean
}

export const URGENT_ITEMS: UrgentItem[] = [
  { id: 'urg_1', kind: 'dm', dmId: 'daniel', name: 'Daniel Stanton' },
  { id: 'urg_2', kind: 'dm', dmId: 'hallie', name: 'Hallie Pratt' },
]

// No file rows: a file resolves from the relay, which mock mode has none of.
export const OPEN_WORK_ITEMS: Exclude<OpenWorkItem, { kind: 'file' }>[] = []

export const STARRED_ENTRIES: StarredEntry[] = [
  { id: 'star_1', kind: 'dm', dmId: 'greg', name: 'Greg Bothman' },
  { id: 'star_2', kind: 'dm', dmId: 'juan', name: 'Juan Foley' },
]
