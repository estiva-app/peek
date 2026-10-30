import type { LinkState, LinkedConversation, LinkedFromOptions, LinkedKind } from '@estiva-app/ui'
import { linkStateFrom } from '@estiva-app/ui'
import type { ForeignObject, People } from '@estiva-app/interop'
import { openingWords } from '@estiva-app/conversation'
import { knownCardValue } from '@/api/foreign'
import { personByPubkey } from '@/api/mentions'
import { openInAppUrl } from '@/lib/appName'
import { referenceGlyph, referenceGlyphOfUri } from '@/lib/fileGlyph'
import { referenceLink } from '@/lib/referenceLink'
import { referenceTypeWord } from '@/lib/textParsing'

/*
  What a link stands for, as the kit's link widgets draw it (LinkChip, LinkRow,
  LinkCard): the kit's one builder from interop's projection (`linkStateFrom`,
  @estiva-app/ui 0.86), so a file draws as one card in Peek, Ship and Leaf
  (5ebf2756; why:
  https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md).
  Peek gives it where a link opens and how a message reads in a line.
*/

/** What a reference names, by its icon, before anything has been read. */
export function linkedKindOf(uri: string): LinkedKind {
  return referenceGlyphOfUri(uri) ?? 'file'
}

export interface LinkedContext {
  /** The workspace's people, for the owner picker's options. */
  directory?: People
  /**
   * Changes the file from its card. Without it the values read as words
   * (Decided 16 Oct: any reader may change a file from its card; words only in
   * a preview and for a file that cannot be read).
   */
  onAct?: (actionId: string, value: string) => void
  /** What was said about it, when the caller has read that. */
  conversation?: LinkedConversation
  /**
   * The URL it was written as: a file that cannot be read reads as that URL, a
   * plain link, never "not available" (SPEC §13.1, C21; Katerina, 30 Oct).
   */
  url?: string
  /** A trusted deletion names it (SPEC §13.6.1): "Issue deleted", not "not available". */
  deleted?: boolean
}

/** A message's own words, for the caller to ask about the links in them (`useLinksIn`); nothing for a file. */
export function messageWordsOf(object: ForeignObject | null | undefined | 'loading'): string | undefined {
  if (!object || object === 'loading' || object.unreachable) return undefined
  return referenceGlyph(object.kind) === 'message' ? object.slots.body?.value : undefined
}

/** Where a reference opens: Peek's own page for its own files, the owning app for anyone else's. */
function hrefOf(uri: string, object: ForeignObject): string {
  const link = referenceLink(uri, object)
  return (link && link.place !== 'app' ? link.href : openInAppUrl(object)) ?? ''
}

/**
 * Where a reference's lookup stands, for the kit: `undefined` or `'loading'` is
 * still asked, `null` an answer of nothing. Nothing, and a file the reader may
 * not read, draw alike: "not available." (Miky, 15 Oct).
 */
export function linkStateOf(uri: string, object: ForeignObject | null | undefined | 'loading', context: LinkedContext = {}): LinkState {
  const { url, deleted, ...rest } = context
  const options: LinkedFromOptions<ForeignObject> = {
    // A row on its card opens as its own reference would: by its address when it has one.
    hrefOf: (file, top) => {
      if (top) return hrefOf(uri, file)
      return file.naddr ? hrefOf(`nostr:${file.naddr}`, file) : (openInAppUrl(file) ?? '')
    },
    // A message's words as every app's preview reads them: an app link it holds as what it names, once that has come
    // back, never the raw URL (Katerina, 30 Oct); the caller asks about them (`useLinksIn`) and draws again.
    previewText: (body, people) => openingWords(body, (pubkey) => people?.[pubkey]?.displayName ?? personByPubkey(pubkey)?.name, { resolveLink: knownCardValue }),
    ...rest,
  }
  // Only a web address is a URL to read as: a reference's own text (`nostr:…`) has nothing to fall back on.
  const written = url && /^https?:[/][/]/i.test(url) ? { url } : {}
  const unread = { kind: linkedKindOf(uri), noun: referenceTypeWord(uri) ?? 'Link', ...(deleted ? { deleted } : {}), ...written }
  return linkStateFrom(object === 'loading' ? undefined : object, unread, options)
}
