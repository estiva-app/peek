import type { MentionPerson } from '@estiva-app/ui/editor'
import { mentionPeople, type Person } from '@/api'

/**
 * Who the composer's `@` (and `!@`) offers, as the package's list takes them.
 *
 * The list itself — its rows (the face, the name, the role line, the shared
 * EnterHint while highlighted), the box, the keys — is the package's
 * `peopleMenu` since CON-27 (estiva-ui 0.52.0), its face included: the kit's
 * `Avatar`, which finds the picture through `AppProvider`. What stays here is
 * Peek's: the directory.
 */
export function toMentionPerson(person: Person): MentionPerson {
  return {
    id: person.id,
    name: person.name,
    description: person.role,
    pubkey: person.pubkey ?? null,
    bot: person.bot,
  }
}

/** The people a message can mention, asked each time the query changes. */
export function mentionDirectory(): MentionPerson[] {
  return mentionPeople().map(toMentionPerson)
}

export { peopleMenu } from '@estiva-app/ui/editor'
