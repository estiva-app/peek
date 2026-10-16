import type { LinkState, Linked, LinkedConversation, LinkedKind, LinkedPicker, StatusColour } from '@estiva-app/ui'
import { thingKindOf } from '@estiva-app/ui'
import type { ForeignObject, People } from '@estiva-app/interop'
import { objectLabel, openInAppUrl } from '@/lib/appName'
import { referenceGlyphOfUri } from '@/lib/fileGlyph'
import { referenceLink } from '@/lib/referenceLink'
import { previewText, referenceTypeWord } from '@/lib/textParsing'

/*
  What a link stands for, as the kit's link widgets draw it (`@estiva-app/ui`
  0.75: LinkChip, LinkRow, LinkCard), built from interop's projection — the
  same object Peek's own card drew, mapped onto the shape Miky approved (why:
  https://github.com/estiva-app/estiva-docs/blob/main/decisions/where-a-link-sits-and-which-file-gets-the-card.md).
*/

const COLOURS: readonly StatusColour[] = ['neutral', 'blue', 'green', 'muted']

function colourOf(colour: string | undefined): StatusColour | undefined {
  return COLOURS.find((known) => known === colour)
}

/** The manifest's `message` widget, wherever it sits in the fallback chain (§13.3). */
function isMessage(object: ForeignObject): boolean {
  return (Array.isArray(object.widget) ? object.widget : [object.widget]).includes('message')
}

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
}

/** Where a reference opens: Peek's own page for its own files, the owning app for anyone else's. */
export function hrefOf(uri: string, object: ForeignObject): string {
  return referenceLink(uri, object)?.href ?? openInAppUrl(object) ?? ''
}

/** The file `uri` names, read from interop's projection of it. */
export function linkedOf(uri: string, object: ForeignObject, { directory, onAct, conversation }: LinkedContext = {}): Linked {
  const { slots, people } = object
  const href = hrefOf(uri, object)
  const id = object.address ?? object.eventId
  const kind = thingKindOf(object.kind)
  if (isMessage(object) && slots.title?.isPubkey) {
    // A message is titled by its author (RIC-11): drawn with their face, then its opening words.
    const person = people?.[slots.title.value]
    const name = person?.displayName ?? '—'
    const body = slots.body?.value ? previewText(slots.body.value) : undefined
    return { id, kind: 'message', title: name, href, author: { name, picture: person?.picture }, ...(body ? { body } : {}) }
  }
  const title = slots.title?.isPubkey ? (people?.[slots.title.value]?.displayName ?? '—') : slots.title?.value || objectLabel(object) || 'Untitled'

  const statusAction = object.actions.find((action) => action.control === 'select' && action.field && action.field === slots.status?.field)
  let status: LinkedPicker | undefined
  if (statusAction) {
    status = {
      value: statusAction.current,
      options: (statusAction.options ?? []).map((option) => ({ value: option.value, label: option.label, colour: colourOf(option.colour) })),
      ...(onAct ? { onChange: (value: string) => onAct(statusAction.id, value) } : {}),
    }
  } else if (slots.status) {
    status = { value: slots.status.value, options: [{ value: slots.status.value, label: slots.status.value, colour: colourOf(slots.status.colour) }] }
  }

  // Who owns it: the manifest's person control that is neither the title nor the move (FOL-4).
  const ownerAction = object.actions.find(
    (action) => action.control === 'pubkey' && action.field && action.field !== slots.title?.field && action.field !== object.parentField,
  )
  let owner: LinkedPicker | undefined
  let ownerLabel: string | undefined
  if (ownerAction) {
    const known = { ...directory }
    // The holder stays pickable while the directory loads, or once they have left it: the object names them.
    if (ownerAction.current && !known[ownerAction.current]) known[ownerAction.current] = people?.[ownerAction.current] ?? {}
    owner = {
      value: ownerAction.current || undefined,
      options: [
        { value: '', label: 'Unassigned' },
        ...Object.entries(known)
          // The em dash for an unnameable person, as `Person` renders — never the key (FEE-1).
          .map(([pubkey, profile]) => ({ value: pubkey, label: profile.displayName ?? '—', picture: profile.picture }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      ],
      ...(onAct ? { onChange: (value: string) => onAct(ownerAction.id, value) } : {}),
    }
    ownerLabel = object.meta.find((slot) => slot.field === ownerAction.field)?.label ?? ownerAction.label
  }

  return {
    id,
    kind,
    title,
    href,
    // Interop gives every file kind a subtitle read from its summary (SPEC §6.12).
    ...(slots.subtitle?.value ? { summary: slots.subtitle.value } : {}),
    ...(status ? { status } : {}),
    ...(owner ? { owner, ownerLabel } : {}),
    ...(conversation ? { conversation } : {}),
  }
}

/**
 * Where a reference's lookup stands, for the kit: `undefined` is still asked,
 * `null` an answer of nothing. Nothing, and a file the reader may not read,
 * draw alike: "not available." (Miky, 15 Oct).
 */
export function linkStateOf(uri: string, object: ForeignObject | null | undefined | 'loading', context?: LinkedContext): LinkState {
  if (object === undefined || object === 'loading') return { state: 'loading', kind: linkedKindOf(uri) }
  if (object === null) return { state: 'unavailable', kind: linkedKindOf(uri), noun: referenceTypeWord(uri) ?? 'Link' }
  if (object.unreachable) {
    const href = openInAppUrl(object)
    return {
      state: 'unavailable',
      kind: thingKindOf(object.kind),
      noun: (object.noun && objectLabel(object)) || `${object.appName ?? 'Another app'} object`,
      ...(href ? { openIn: { app: object.appName ?? 'app', href } } : {}),
    }
  }
  return { state: 'ready', linked: linkedOf(uri, object, context) }
}
