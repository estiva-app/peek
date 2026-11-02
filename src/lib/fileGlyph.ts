import { KIND_CHANNEL_METADATA } from '@estiva-app/interop'
import { referenceToPointer } from '@estiva-app/protocol'
import { thingKindOf, type ThingKind } from '@estiva-app/ui'

/** Which glyph a file wears before its name, everywhere Peek draws one: the kit's kinds of thing, less a message. */
export type FileGlyph = Exclude<ThingKind, 'message'>

/**
 * The glyph for a file of this kind: the kit's `thingKindOf`, which every app
 * reads alike (Katerina, 8 October) — Peek's bare file is a topic, a Ship
 * project and issue are themselves, anything else is another app's file.
 *
 * Two answers stay as Peek drew them, so nothing changes on screen (audit A13,
 * 2 November): a Folder listed inside another Folder (FOL-22) is a row whose
 * kind is a channel's, which the kit calls a topic and Peek's rows always drew
 * as a file; and a message is never a row, so its kind is a file here too.
 */
export function fileGlyph(kind: number | undefined): FileGlyph {
  if (kind === KIND_CHANNEL_METADATA) return 'file'
  const thing = thingKindOf(kind)
  return thing === 'message' ? 'file' : thing
}

/**
 * What a `nostr:` URI names, as a body carries it — for a chip that holds
 * only that. A message's `nevent`/`note` is a message; an `naddr` is judged by
 * its kind (`thingKindOf`); anything else (a person, a URI that does not parse)
 * is not one of these, and `undefined` leaves the caller its own icon.
 */
export function referenceGlyphOfUri(uri: string | null | undefined): ThingKind | undefined {
  if (!uri) return undefined
  if (/^nostr:(?:nevent1|note1)/i.test(uri)) return 'message'
  if (!/^nostr:naddr1/i.test(uri)) return undefined
  try {
    return thingKindOf(referenceToPointer(uri).kind)
  } catch {
    return undefined
  }
}

/** The same, from an address (`kind:pubkey:d`) — for a file known only by where it is. */
export function fileGlyphOfAddress(address: string): FileGlyph {
  return fileGlyph(Number(address.split(':')[0]))
}
