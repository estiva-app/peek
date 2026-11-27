import type { ForeignObject } from '@estiva-app/interop'
import type { RowNewsItem } from '@/api/rowNews'

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
  | {
      id: string
      /** A team's chat (Katerina, 16 November, Q-37: Open work learns to hold one). The Desk names it from its team. */
      kind: 'chat'
      /** The chat's address, `39000:<pubkey>:<team>`, as Open work holds it. */
      address: string
    }
  | {
      id: string
      /**
       * A file not answered yet, by the copy or the relay: a placeholder row where it will appear, so Open work never
       * says it is empty while it has entries (Miky, 27 Nov, aec00dfc). Answered as nothing, it draws no row.
       */
      kind: 'loading'
      address: string
    }

export type UrgentItem =
  | {
      id: string
      kind: 'dm'
      dmId: string
      name: string
      avatarSrc?: string
    }
  | {
      id: string
      /** A file with an unread comment urgent for the viewer (CON-17). */
      kind: 'file'
      address: string
      /** The root's kind — a bare file draws as a topic. */
      fileKind: number
      title: string
      /** Its summary (SPEC §6.12), shown when the row's title is hovered; absent, no tooltip. */
      summary?: string
      /** The unread urgent comments that put it here, newest first: its card (ACT-9). Absent in the mocks. */
      news?: readonly RowNewsItem[]
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
