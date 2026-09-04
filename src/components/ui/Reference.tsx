import { useSyncExternalStore } from 'react'
import { decodeNpub } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { mentionsVersion, personByPubkey, subscribeMentions } from '@/api/mentions'
import { cn } from '@/lib/utils'
import { StatusPill } from './ForeignObjectWidget'

/**
 * A `nostr:` reference drawn where it was written — SPEC §13.1, RIC-10.
 *
 * **One component for every kind of reference, on purpose.** Miky's framing is
 * that "everything you mention in Nostr for Business protocol is basically a
 * file. Even things like different topic, message, or even specific person" — so
 * a person and a project are one idea pointed at two things, and drawing them
 * with two unrelated mechanisms is how the display-name mention drifted away
 * from the projection layer to begin with. This replaces `MentionChip`, which
 * knew only about people and returned an object's raw URI as text.
 *
 * What it draws depends on what the URI turns out to name, never on the caller
 * knowing in advance:
 *
 * - **an `npub`** — the person, from Peek's directory
 * - **anything the projection layer resolved** — the object's title, and its
 *   status where the manifest declares one, through the same `StatusPill` the
 *   attachment card uses so the two cannot disagree about what a status is
 * - **anything else** — the URI's own shortened form
 *
 * That last row is §13.1's rule, and it is not a fallback in the apologetic
 * sense: *"never blank"*. A reference to something outside this workspace still
 * says a reference is there, which is the honest answer.
 *
 * **It never resolves anything itself.** A body's references are resolved once
 * for the whole body, so the same object cannot appear in two states on one
 * screen and a message costs one round trip per reference rather than one per
 * place it is mentioned. It is also what keeps `ForeignBody` safe: another
 * app's body passes no resolved objects, so a reference inside a widget draws a
 * chip and cannot pull a second object in behind it.
 */
export function Reference({
  uri,
  object,
  className,
}: {
  uri: string
  /**
   * The resolved object, when the URI names one. `undefined` means still
   * resolving or never asked, `null` means resolved to nothing — different
   * facts, drawn the same way, because neither is something a reader can act
   * on.
   */
  object?: ForeignObject | null
  className?: string
}) {
  /*
    Re-read when the directory is replaced.

    `personByPubkey` answers from a module-level snapshot, which is right — the
    suggestion plugins are not components and cannot hold a hook. But a module
    variable cannot tell React it changed, so a chip drawn before the people
    query landed stayed unresolved until something else re-rendered it. On a
    cold load that is every mention in view, because the snapshot starts as the
    mock cast whose keys match nobody real.

    This is a component, so it can subscribe. Nothing else has to. Subscribed
    unconditionally — hooks cannot sit behind the `npub` branch below — and an
    object reference re-rendering when the directory arrives costs nothing.
  */
  useSyncExternalStore(subscribeMentions, mentionsVersion, mentionsVersion)

  const short = `${uri.replace(/^nostr:/, '').slice(0, 12)}…`
  const base = 'rounded-sm px-1 mx-0.5 text-body-2 font-normal select-none'
  const quiet = 'bg-bg-active text-text-muted font-mono text-caption'

  if (/^nostr:npub1/i.test(uri)) {
    let pubkey: string | null = null
    try {
      pubkey = decodeNpub(uri)
    } catch {
      pubkey = null
    }
    const person = pubkey ? personByPubkey(pubkey) : undefined
    return (
      <span
        data-reference="person"
        data-mention={pubkey ?? undefined}
        data-resolved={person ? 'true' : 'false'}
        title={person ? undefined : uri}
        className={cn(
          base,
          // An unresolved key is still a mention, just an anonymous one. Muted
          // rather than absent, so nobody reads a stranger's key as an error.
          person ? 'bg-accent-muted text-accent-primary' : quiet,
          className,
        )}
      >
        {person ? `@${person.name}` : short}
      </span>
    )
  }

  if (object && !object.unreachable) {
    const title = object.slots.title?.value ?? short
    return (
      <span
        data-reference="object"
        data-object={object.address}
        data-resolved="true"
        // The full title on hover, because the visible one is truncated.
        title={title}
        className={cn(base, 'inline-flex items-center gap-1 bg-bg-active text-text-primary', className)}
        /*
          The same box a `[Topic]` chip gets: one line high, aligned to the text
          baseline it sits on. A chip that grows to two lines pushes the line
          apart and drags its status pill to the middle of the gap — which is
          what an 84-character issue title did on the first run of
          `ric10-live-check.ts`, and the screenshot is why this is not left to
          the natural width.

          Truncated rather than wrapped, and `ch` rather than pixels so it
          scales with the type: a mention is a word in a sentence, and the whole
          title is a sentence of its own. Ship's inline reference truncates for
          the same reason.
        */
        style={{ verticalAlign: 'text-bottom', height: '1.4em', maxWidth: '24ch' }}
      >
        <span className="truncate">{title}</span>
        {object.slots.status && <StatusPill slot={object.slots.status} className="shrink-0" />}
      </span>
    )
  }

  return (
    <span
      data-reference={object === null ? 'unresolved' : 'pending'}
      title={uri}
      className={cn(base, quiet, className)}
    >
      {short}
    </span>
  )
}
