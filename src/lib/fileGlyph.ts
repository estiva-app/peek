import { KIND_BARE_FILE } from '@estiva-app/interop'
import { MESSAGE_KIND, TOPIC_KIND } from '@/nostr/manifest'

/**
 * Ship's project and issue kinds (Ship's manifest). Peek names them only to
 * give them Ship's own glyphs (Katerina, 7 October); nothing else here asks
 * what kind another app's file is. When a manifest can declare its files'
 * glyph, this map goes and the manifest's answer is drawn instead.
 */
const KIND_SHIP_PROJECT = 30850
const KIND_SHIP_ISSUE = 30851

/** Which glyph a file wears before its name, everywhere Peek draws one. */
export type FileGlyph = 'topic' | 'project' | 'issue' | 'file'

/**
 * The glyph for a file of this kind: Peek's bare file is a topic; a Ship
 * project wears Ship's box and an issue Ship's list, the icons Ship's own
 * sidebar and "Mentioned in" lines give them; anything else is a file.
 */
export function fileGlyph(kind: number | undefined): FileGlyph {
  if (kind === KIND_BARE_FILE) return 'topic'
  if (kind === KIND_SHIP_PROJECT) return 'project'
  if (kind === KIND_SHIP_ISSUE) return 'issue'
  return 'file'
}

/** What a reference can name: a file, or a message. */
export type ReferenceGlyph = FileGlyph | 'message'

/**
 * The glyph for a referenced object (SPEC §13.1): a message is a message; a
 * channel is a topic, as `referenceLink` opens it; anything else is a file,
 * by `fileGlyph`.
 */
export function referenceGlyph(kind: number | undefined): ReferenceGlyph {
  if (kind === MESSAGE_KIND) return 'message'
  if (kind === TOPIC_KIND) return 'topic'
  return fileGlyph(kind)
}

/** The same, from an address (`kind:pubkey:d`) — for a file known only by where it is. */
export function fileGlyphOfAddress(address: string): FileGlyph {
  return fileGlyph(Number(address.split(':')[0]))
}
