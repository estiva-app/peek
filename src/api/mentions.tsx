/**
 * The @mention directory.
 *
 * The Tiptap suggestion plugins (`@name`, `!@name`) aren't React components,
 * so they can't read a hook. They read this module-level snapshot instead,
 * which `MentionDirectorySync` keeps in step with the real workspace people.
 *
 * Default = the mock PEOPLE, so Storybook/tests and the no-backend demo keep
 * suggesting the sample cast exactly as before.
 */
import { useEffect } from 'react'
import { PEOPLE as MOCK_PEOPLE } from '@/data/peopleData'
import { setMentionNames } from '@/lib/textParsing'
import { getActiveConversation, type ConversationMessage } from '@/lib/conversationRegistry'
import { useCurrentUser } from './currentUser'
import { useMentionNames, usePeople } from './people'
import type { Person } from './types'

/** Suggestion list — the other workspace people (you don't @mention yourself). */
let directory: Person[] = MOCK_PEOPLE

/**
 * Bumped whenever {@link directory} is replaced, so a React renderer can notice.
 *
 * **The snapshot being module-level is deliberate; being unobservable was not.**
 * `personByPubkey` is read while drawing a run, and a plain module variable
 * cannot tell React it changed — so a body drawn before the people query
 * resolved kept its raw `npub…` chips for as long as nothing else happened to
 * re-render it. `directory` starts as the mock cast, whose keys match nobody
 * real, so on a cold load *every* mention drew unresolved and stayed that way.
 *
 * That is why it looked intermittent rather than broken: whether a mention
 * showed a name depended on whether its message was drawn before or after one
 * Convex query landed.
 */
let version = 0
const listeners = new Set<() => void>()

/**
 * Pubkey to name, for **everyone Peek can name** — which is not the directory.
 *
 * `directory` is the suggestion list and excludes the viewer and relay-only
 * identities, both correctly. Resolving a mention excludes neither: a mention of
 * you is still a mention, and a key Peek has only seen on the relay still
 * belongs to somebody it can name. Reusing one list for both questions is what
 * made a mention of Katerina draw as `npub14znawww…`.
 */
let resolvable = new Map<string, string>(
  MOCK_PEOPLE.flatMap((p) => (p.pubkey ? [[p.pubkey, p.name] as [string, string]] : [])),
)

/** For `useSyncExternalStore`. */
export function subscribeMentions(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** The snapshot, as a primitive — the lists themselves are replaced wholesale. */
export function mentionsVersion(): number {
  return version
}

function publish(next: Person[], names?: Map<string, string>): void {
  directory = next
  if (names) resolvable = names
  version += 1
  for (const listener of listeners) listener()
}

/** Read by the Tiptap suggestion plugins when a popup opens. */
export function mentionPeople(): Person[] {
  return directory
}

/**
 * Who a `nostr:npub…` in a body names — SPEC §13.1's `reference` mark.
 *
 * Module-level for the same reason the suggestion lists are: the renderer that
 * needs it is inside a `RenderBlocks` callback rather than a component that can
 * hold a hook, and it must answer synchronously while drawing a run.
 *
 * **Returning `undefined` is a normal answer, not a failure.** A key belonging
 * to somebody outside this workspace, or to a person whose profile has not
 * arrived, resolves to nobody — and §13.1 says what to draw then: the URI's own
 * shortened form, never blank. That is the whole point of writing the key
 * instead of the name; the mention still says *who*, even where nothing can say
 * what they are called.
 */
export function personByPubkey(pubkey: string): Person | undefined {
  // The resolution map first: it is the one that covers everybody, including
  // the viewer and identities Peek has only seen on the relay. The suggestion
  // list is still consulted, so a mention resolves as soon as either source
  // knows the key rather than waiting for the wider query.
  const name = resolvable.get(pubkey)
  if (name) return { id: pubkey, name, role: '' }
  return directory.find((p) => p.pubkey === pubkey)
}

/**
 * The messages the `[` menu can offer — those on screen that the relay holds
 * (RIC-11).
 *
 * On screen, because that is where somebody pointing at "what Ada said" is
 * looking; the open thread wins over the topic around it, the way it does for
 * a question asked of Cmd+K. Only messages with an event id, because a mention
 * is written as `nostr:nevent…` and a message still on its way to the relay
 * has nothing to be pointed at yet. The relay's own search (NIP-50, whole
 * tokens only) is not consulted here: the launcher already offers it, and a
 * menu that answers differently mid-word than after a space is the kind of
 * thing that reads as broken rather than as a tokenised index.
 */
export function mentionMessages(): ConversationMessage[] {
  return (getActiveConversation()?.messages ?? []).filter((m) => !!m.eventId)
}

/**
 * Keeps the people a message can @-mention in step with the workspace's
 * people and their names. Draws nothing; mounted by PeekDataProvider.
 */
export function MentionDirectorySync() {
  const people = usePeople()
  const knownNames = useMentionNames()
  const me = useCurrentUser()
  useEffect(() => {
    publish(
      people ?? MOCK_PEOPLE,
      knownNames ? new Map(knownNames.map((n) => [n.pubkey, n.name])) : undefined,
    )
    // The body renderer matches mentions by name, so it needs the FULL cast —
    // including the viewer's own name, or a mention OF you renders as plain
    // text in your view while everyone else sees a chip (issue #10). The
    // suggestion list stays "other people" (above); only the render names
    // include you.
    const names = directory.map((p) => p.name)
    if (me?.name) names.push(me.name)
    setMentionNames(names)
  }, [people, knownNames, me])
  return null
}
