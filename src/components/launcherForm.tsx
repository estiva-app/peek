import type { LauncherFormHost } from '@estiva-app/launcher'
import { encodeNpub } from '@estiva-app/protocol'
import type { DocumentMentions, DocumentReferences } from '@estiva-app/ui/editor'
import { referenceSections, subscribeReferences, type Person } from '@/api'
import { BoxReference } from './ui/BoxReference'
import { FILES_MENU_COPY } from './ui/FilesMenu'
import { mentionDirectory } from './ui/MentionMenu'
import { PersonChipInput } from './ui/PersonChipInput'

/** `[`: what the comment box's `[` offers, in its words. */
const PROSE_REFERENCES: DocumentReferences = { sections: referenceSections, subscribe: subscribeReferences, ...FILES_MENU_COPY }

/** `@`: the people a message can mention, each written as their `nostr:npub`. */
const PROSE_MENTIONS: DocumentMentions = {
  people: mentionDirectory,
  uriOf: (person) => (person.pubkey ? `nostr:${encodeNpub(person.pubkey)}` : null),
}

/**
 * What the launcher's form fields need of Peek (KIN-4): what `[` and `@` offer
 * inside a description, how a reference draws, and the person picker over
 * Peek's people. The fields themselves are `@estiva-app/launcher`'s.
 */
export const PEEK_FORM: LauncherFormHost = {
  references: PROSE_REFERENCES,
  mentions: PROSE_MENTIONS,
  referenceView: BoxReference,
  // The people in a draft are the ones this picker handed over, so they are Peek's `Person`.
  personField: ({ value, single, onChange, placeholder }) => (
    <PersonChipInput value={value as Person[]} single={single} onChange={onChange} placeholder={placeholder} />
  ),
}
