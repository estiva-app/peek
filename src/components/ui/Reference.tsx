import { useSyncExternalStore, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import { decodeNpub } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { mentionsVersion, personByPubkey, subscribeMentions } from '@/api/mentions'
import { findMessageByEventId } from '@/lib/conversationRegistry'
import { scrollToMessage, scrollToMessageWhenReady } from '@/lib/messageAnchor'
import { writtenLinkOf, referenceLink, type ReferenceLink } from '@/lib/referenceLink'
import { openConversation } from '@/lib/threadOpener'
import { previewText } from '@/lib/textParsing'
import { InlineChip, KindIcon, WithTooltip, type InlineChipTone } from '@estiva-app/ui'
import { referenceGlyph } from '@/lib/fileGlyph'
import { StatusPill } from './ForeignObjectWidget'

/**
 * What a resolved object is called, in a chip's worth of words.
 *
 * The title slot, read the way the manifest declared it: `as: "pubkey"` means
 * *show a person*, and the object's `people` is where the runtime put their
 * name — drawing the value itself would put 64 hex characters where a name
 * goes, which is what a Peek message did the first time one was mentioned
 * (RIC-11): its manifest titles a message by its author, because a message
 * has no title of its own. Undefined when there is no title to read, which
 * the caller draws as the URI's shortened form.
 *
 * A message also gets its opening words, because "Ada" is not enough to know
 * *which* message — the same caption the composer's chip wears, so the
 * mention reads the same before and after it is sent.
 */
function objectLabel(object: ForeignObject): string | undefined {
  const title = object.slots.title
  if (!title) return undefined
  const name = title.isPubkey ? (object.people?.[title.value]?.displayName ?? shortKey(title.value)) : title.value
  const body = object.slots.body?.value
  return body && isMessage(object) ? `${name}: ${previewText(body)}` : name
}

/** The manifest's `message` widget, wherever it sits in the fallback chain (§13.3). */
function isMessage(object: ForeignObject): boolean {
  return (Array.isArray(object.widget) ? object.widget : [object.widget]).includes('message')
}

function shortKey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…`
}

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
 * **A chip that names something leads to it (RIC-16).** It was a label from the
 * prototype on — Miky, after the first pointer mention on production: *"It only
 * creates a label, but not really a link to the mentioned thing."* Now a person
 * opens their DM, a topic opens the topic, a message opens its conversation and
 * lands on it, and another app's object opens in that app — `referenceLink`
 * decides which from what resolved. The anchor is real, so open-in-new-tab and
 * copy-link work; a plain left click is intercepted and routed in place, the
 * way `NavItem` does it, because a bare anchor would reload the
 * app. Outside a router — a story, a test — it stays a plain anchor.
 *
 * A click on a chip is a click on the chip, not on the card under it: the card
 * opens its thread on click, and following a mention must not also do that
 * (`data-interactive` is the card's contract for "not mine").
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
  link = true,
  urgent,
  className,
  opensAt,
}: {
  uri: string
  /** The URL it was written as: a link to one block opens there, not at the top of its file (§13.6.1, WBM-11). */
  opensAt?: string
  /**
   * The keys the message names urgently — its `["urgent", <pubkey>]` tags
   * (SPEC §13.1). A person chip for one of them wears the urgent tone, for
   * every reader, as it did in the composer (CON-24). The text cannot say it:
   * an urgent mention is the same `nostr:npub…` as an ordinary one.
   */
  urgent?: readonly string[]
  /**
   * Whether the chip leads to what it names. `false` in the composer (UIG-40):
   * the same chip as in the sent message, but while it is being written a click
   * is not a way out of the draft, and the editor draws every link blue and
   * underlined, which the sent chip never is.
   */
  link?: boolean
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
  // Every chip below is the package's InlineChip (D67, moved into the package by
  // UIG-27): the same shape as a `[Topic]` in the reader and in the editor.
  // What a chip cuts short — a long title, an address — is on hover in the
  // package's tooltip, not a `title` (UIG-14).

  if (/^nostr:npub1/i.test(uri)) {
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
        link={link && person && pubkey ? { place: 'person', href: `/app/people/${pubkey}` } : null}
        data-reference="person"
        data-mention={pubkey ?? undefined}
        data-resolved={person ? 'true' : 'false'}
        // An unresolved key is still a mention, just an anonymous one. Muted
        // rather than absent, so nobody reads a stranger's key as an error.
        tone={person ? (pubkey && urgent?.includes(pubkey) ? 'urgent' : 'person') : 'quiet'}
        className={className}
      >
        {person ? `@${person.name}` : short}
      </Chip>
    )
    // A name says itself; a key nobody could name shows its whole address.
    return person ? chip : <Tip label={uri}>{chip}</Tip>
  }

  if (object && !object.unreachable) {
    const title = objectLabel(object) ?? short
    return (
      // The full title on hover, because the visible one is truncated.
      <Tip label={title}>
        <Chip
          link={link ? (writtenLinkOf(opensAt, referenceLink(uri, object)?.href) ?? referenceLink(uri, object)) : null}
          data-reference="object"
          data-object={object.address}
          data-resolved="true"
          tone="neutral"
          // What it is, before its name: a topic, a Ship project or issue, a file or a message (Katerina, 7 October).
          icon={<KindIcon kind={referenceGlyph(object.kind)} size={14} tone="inherit" />}
          className={className}
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
          style={{ maxWidth: '24ch' }}
        >
          <span className="truncate">{title}</span>
          {object.slots.status && <StatusPill slot={object.slots.status} className="shrink-0" />}
        </Chip>
      </Tip>
    )
  }

  return (
    <Tip label={uri}>
      <InlineChip tone="quiet" data-reference={object === null ? 'unresolved' : 'pending'} className={className}>
        {short}
      </InlineChip>
    </Tip>
  )
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

type ChipLink = ReferenceLink | { place: 'person'; href: string }

type ChipProps = Omit<HTMLAttributes<HTMLElement>, 'onClick'> & {
  /** Where the chip leads, or null for a chip that is a label only. */
  link: ChipLink | null
  tone: InlineChipTone
  /** Before the label: what the referenced thing is. */
  icon?: ReactNode
  children: ReactNode
}

/**
 * The chip: the package's InlineChip, an anchor when it leads somewhere, a span when it does not.
 *
 * Split in two so the router hook is only ever called inside a router.
 * `useInRouterContext` is always called; `useNavigate` lives in the routed
 * variant, which only mounts when there is a router to navigate with. Outside
 * one the anchor is plain and its `href` still real — a story or a test gets a
 * link that would work, not a crash.
 */
function Chip({ link, ...rest }: ChipProps) {
  const inRouter = useInRouterContext()
  if (!link) return <InlineChip {...rest} />
  return inRouter ? <RoutedChip link={link} {...rest} /> : <PlainChip link={link} {...rest} />
}

const isModified = (event: MouseEvent) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey

/** Another app's URL opens in a new tab; a stranger published it into a shared relay, hence `noopener`. */
const targetFor = (link: ChipLink) =>
  link.place === 'app' ? { target: '_blank', rel: 'noopener noreferrer' } : {}

function PlainChip({ link, ...rest }: ChipProps & { link: ChipLink }) {
  return <InlineChip href={link.href} data-interactive="" onClick={(event) => event.stopPropagation()} {...targetFor(link)} {...rest} />
}

function RoutedChip({ link, ...rest }: ChipProps & { link: ChipLink }) {
  const navigate = useNavigate()
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    // The card underneath opens a thread on click; a click on a mention is not that.
    event.stopPropagation()
    // Another app's link is the browser's to follow, and so is any modified
    // click — open-in-new-tab keeps working, as the router link allowed.
    if (link.place === 'app' || isModified(event)) return
    event.preventDefault()
    if (link.place === 'message') {
      /*
        The same three steps a citation takes (INT-3, INT-8), because the
        message is often on screen already: scroll to it if its thread is open,
        open its thread if the topic is, and only otherwise leave the page.
        `/message/<id>` finds the topic and lands on the message either way —
        that is the slow path, not a different destination.
      */
      const here = findMessageByEventId(link.eventId)
      if (here) {
        if (scrollToMessage(here.id)) return
        if (here.conversationId && openConversation(here.conversationId)) {
          void scrollToMessageWhenReady(here.id)
          return
        }
      }
    }
    navigate(link.href)
  }
  return <InlineChip href={link.href} data-interactive="" onClick={follow} {...targetFor(link)} {...rest} />
}
