/*
  A DM or a followed file. A Convex topic was the third kind until FOL-23.
*/
export type ScreenerItem =
  | {
      id: string
      kind: 'dm'
      /** The partner's person key — the DM's id (§2.4). */
      dmId: string
      authorName: string
      authorAvatarSrc?: string
      preview: string
    }
  | {
      id: string
      /** A followed file with a comment the viewer has not read (FOL-34). */
      kind: 'file'
      /** `kind:pubkey:d`. */
      address: string
      /** The file's kind, for the glyph: a bare-file topic draws as a topic. */
      fileKind: number
      title: string
      preview: string
      /** Archived by someone while still unread here: it stays, marked (PEE-68, Miky 19 Oct). */
      archived?: boolean
    }

// No file rows: a file resolves from the relay, which mock mode has none of.
export const SCREENER_ITEMS: Exclude<ScreenerItem, { kind: 'file' }>[] = [
  {
    id: 'sc_2',
    kind: 'dm',
    dmId: 'amie',
    authorName: 'Amie Miles',
    preview:
      "Q4 platform allocation needs your sign-off by Friday - we're trading two weeks of payments work for the auth migration. Want to make sure it lands with you before I bring it to leadership.",
  },
]
