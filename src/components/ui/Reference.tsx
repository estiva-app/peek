import { useSyncExternalStore, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import { decodeNpub } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { mentionsVersion, personByPubkey, subscribeMentions } from '@/api/mentions'
import { linkStateOf } from '@/lib/linked'
import { InlineChip, isPlainClick, LinkChip, WithTooltip, type InlineChipTone } from '@estiva-app/ui'

/**
 * A `nostr:` reference drawn where it was written — SPEC §13.1, RIC-10.
 *
 * **One component for every kind of reference, on purpose.** Miky's framing is
 * that "everything you mention in Nostr for Business protocol is basically a
 * file. Even things like different topic, message, or even specific person" — so
 * a person and a project are one idea pointed at two things. What it draws
 * depends on what the URI turns out to name, never on the caller knowing in
 * advance:
 *
 * - **an `npub`** — the person, from Peek's directory; a person opens their DM
 * - **anything else** — the kit's `LinkChip`, as a message and the comment box
 *   draw it (audit A14, Katerina 2 November): what it is, its key, its title cut
 *   short and its status as a shape; loading while it is asked, "not available"
 *   when it answers nothing. It was a chip of Peek's own until then, with the
 *   status in coloured words.
 *
 * A click on a chip is a click on the chip, not on the card under it: the card
 * opens its thread on click, and following a mention must not also do that
 * (`data-interactive` is the card's contract for "not mine").
 *
 * **It never resolves anything itself.** A body's references are resolved once
 * for the whole body, so the same object cannot appear in two states on one
 * screen and a message costs one round trip per reference rather than one per
 * place it is mentioned.
 */
export function Reference({
  uri,
  object,
  link = true,
  urgent,
  className,
}: {
  uri: string
  /**
   * The keys the message names urgently — its `["urgent", <pubkey>]` tags
   * (SPEC §13.1). A person chip for one of them wears the urgent tone, for
   * every reader, as it did in the composer (CON-24). The text cannot say it:
   * an urgent mention is the same `nostr:npub…` as an ordinary one.
   */
  urgent?: readonly string[]
  /**
   * Whether the chip leads to what it names. `false` in an editor (UIG-40):
   * the same chip as in the sent message, but while it is being written a click
   * is not a way out of the draft, and its card does not open on hover.
   */
  link?: boolean
  /**
   * The resolved object, when the URI names one. `undefined` means still
   * resolving or never asked, `null` means resolved to nothing.
   */
  object?: ForeignObject | null
  /** A person's chip only: the kit's `LinkChip` takes no class. */
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

  if (!/^nostr:npub1/i.test(uri)) {
    const chip = <LinkChip link={linkStateOf(uri, object)} preview={link} />
    // In an editor the chip is not a way out of the draft: its click is held, as the kit's comment box holds its own.
    return link ? chip : <span onClickCapture={(event) => event.preventDefault()}>{chip}</span>
  }

  let pubkey: string | null = null
  try {
    pubkey = decodeNpub(uri)
  } catch {
    pubkey = null
  }
  const person = pubkey ? personByPubkey(pubkey) : undefined
  const chip = (
    <Chip
      // A person opens their DM — `/app/people/<pubkey>` is the DM with them (§2.4, REM-3).
      href={link && person && pubkey ? `/app/people/${pubkey}` : null}
      data-reference="person"
      data-mention={pubkey ?? undefined}
      data-resolved={person ? 'true' : 'false'}
      // An unresolved key is still a mention, just an anonymous one. Muted
      // rather than absent, so nobody reads a stranger's key as an error.
      tone={person ? (pubkey && urgent?.includes(pubkey) ? 'urgent' : 'person') : 'quiet'}
      className={className}
    >
      {/* The package's InlineChip (D67, UIG-27). A key nobody could name is cut short here, and whole in the tooltip (UIG-14). */}
      {person ? `@${person.name}` : `${uri.replace(/^nostr:/, '').slice(0, 12)}…`}
    </Chip>
  )
  // A name says itself; a key nobody could name shows its whole address.
  return person ? chip : <Tip label={uri}>{chip}</Tip>
}

/**
 * The package's tooltip around a chip in a line of text. `inline`, so the
 * wrapper is a `<span>`: a reference sits in a `<p>`, a heading or a list
 * item, where a `<div>` is not allowed. A long label wraps in the tooltip at
 * 320px (0.24.0).
 *
 * The inline wrapper sits on the line's top (`align-top`, 0.24.1): the chip's
 * own `vertical-align: top` stops applying once it is a flex item inside the
 * wrapper, and at the default `baseline` the chip's words would ride off the
 * sentence's. Peek drew a span of its own around it for that until the
 * package's wrapper carried it (UIG-14, F1).
 */
function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <WithTooltip inline label={label}>
      {children}
    </WithTooltip>
  )
}

type ChipProps = Omit<HTMLAttributes<HTMLElement>, 'onClick'> & {
  /** Where the chip leads, or null for a chip that is a label only. */
  href: string | null
  tone: InlineChipTone
  children: ReactNode
}

/**
 * A person's chip: the package's InlineChip, an anchor when it leads somewhere, a span when it does not.
 *
 * Split in two so the router hook is only ever called inside a router.
 * `useInRouterContext` is always called; `useNavigate` lives in the routed
 * variant, which only mounts when there is a router to navigate with. Outside
 * one the anchor is plain and its `href` still real — a story or a test gets a
 * link that would work, not a crash.
 */
function Chip({ href, ...rest }: ChipProps) {
  const inRouter = useInRouterContext()
  if (href === null) return <InlineChip {...rest} />
  return inRouter ? <RoutedChip href={href} {...rest} /> : <PlainChip href={href} {...rest} />
}

function PlainChip({ href, ...rest }: ChipProps & { href: string }) {
  return <InlineChip href={href} data-interactive="" onClick={(event) => event.stopPropagation()} {...rest} />
}

function RoutedChip({ href, ...rest }: ChipProps & { href: string }) {
  const navigate = useNavigate()
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    // The card underneath opens a thread on click; a click on a mention is not that.
    event.stopPropagation()
    // Any modified click is the browser's to follow — open-in-new-tab keeps working, as the router link allowed.
    if (!isPlainClick(event)) return
    event.preventDefault()
    navigate(href)
  }
  return <InlineChip href={href} data-interactive="" onClick={follow} {...rest} />
}
