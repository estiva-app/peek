import { useSyncExternalStore } from 'react'
import { decodeNpub } from '@estiva-app/protocol'
import { mentionsVersion, personByPubkey, subscribeMentions } from '@/api/mentions'
import { cn } from '@/lib/utils'

/**
 * A `nostr:npub…` in a body, drawn as the person it names — SPEC §13.1.
 *
 * **This is the half of a mention that used to need a shared directory.** The
 * old form was the display name — `@Ada Lovelace` — resolved against Peek's own
 * `PEOPLE`, so another app rendered plain text and a rename desynchronised the
 * body from its `p` tags for ever, because message content is immutable.
 *
 * A key resolves for anyone and survives a rename, because it never said the
 * name. What it does *not* do is guarantee a name is available, and §13.1 is
 * explicit about that case: render "the URI's own label or its shortened form,
 * never blank". So a key belonging to somebody outside this workspace still
 * draws a chip — a mention that says *who* without saying what they are called
 * is the correct outcome, not a degraded one.
 */
export function MentionChip({ uri, className }: { uri: string; className?: string }) {
  /*
    Re-read when the directory is replaced.

    `personByPubkey` answers from a module-level snapshot, which is right — the
    suggestion plugins are not components and cannot hold a hook. But a module
    variable cannot tell React it changed, so a chip drawn before the people
    query landed stayed unresolved until something else re-rendered it. On a
    cold load that is every mention in view, because the snapshot starts as the
    mock cast whose keys match nobody real.

    This chip *is* a component, so it can subscribe. Nothing else has to.
  */
  useSyncExternalStore(subscribeMentions, mentionsVersion, mentionsVersion)

  let pubkey: string
  try {
    pubkey = decodeNpub(uri)
  } catch {
    // Not an npub — an naddr, a note, or something malformed. Objects are drawn
    // as widgets below the text, so there is nothing to do here but leave the
    // token as it was written.
    return <>{uri}</>
  }

  const person = personByPubkey(pubkey)
  const label = person?.name ?? `${uri.replace(/^nostr:/, '').slice(0, 12)}…`

  return (
    <span
      data-mention={pubkey}
      data-resolved={person ? 'true' : 'false'}
      title={person ? undefined : uri}
      className={cn(
        'rounded-sm px-1 mx-0.5 text-sm font-normal select-none bg-accent-muted text-accent-primary',
        // Unresolved keys are still mentions, just anonymous ones. Muted rather
        // than absent, so nobody reads a stranger's key as an error.
        !person && 'bg-bg-active text-text-muted font-mono text-xs',
        className,
      )}
    >
      {person ? `@${label}` : label}
    </span>
  )
}
