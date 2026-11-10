import { useCallback, useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconDotsVertical } from '@tabler/icons-react'
import { PEOPLE, PeekDataProvider } from '@/api'
import { KindIcon, SuggestionMenu } from '@estiva-app/ui'
import type { SuggestionPopupOptions } from '@estiva-app/ui/editor'
import type { ConversationMessage } from '@/lib/conversationRegistry'
import { ScreenerLaterMenu } from './ScreenerLaterMenu'
import { NavItem } from '@estiva-app/ui'
import { IconButton } from './ui/IconButton'
import { TopicMenuItems, TopicMoreMenu } from './ui/TopicMoreMenu'
import { toReferenceItem } from './ui/FilesMenu'
import { referenceGlyphOfUri } from '@/lib/fileGlyph'
import { addrToNaddr } from '@estiva-app/protocol'
import { filterReferences, referenceMenu, type CaptionedItem } from '@estiva-app/ui/editor'
import { peopleMenu, toMentionPerson } from './ui/MentionMenu'

/**
 * Every menu Peek opens, on one page. The dialogs went the other way on 23
 * September — each to its own entry, under the place in the app it belongs to —
 * and the menus stayed together, because a menu is a list of Peek's words and
 * what is worth comparing is one list against the next. Each is the package's
 * `Menu` or `Popover` with Peek's rows in it.
 */
const meta = {
  title: 'Overlays/Menus',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/* ── Topic more menu ────────────────────────────────────────────────────── */

/**
 * The one menu a topic has.
 *
 * There were two before, written a few files apart, and they had already
 * drifted: the sidebar row offered "Delete topic" and the conversation header
 * did not, so a topic could be deleted from the list but not from inside
 * itself. Both now render this, which is the only way that stops happening
 * again (PEE-2).
 *
 * Deliberately short. Star and the Folder link are already icons in the
 * conversation header, and repeating them here would lengthen the menu without
 * making either easier to reach (Katerina, 2026-08-19).
 *
 * Items appear only when the caller passes a handler for them, so the menu is
 * never a list of things that cannot happen here.
 *
 * The menu owns its trigger, so these canvases open on a press rather than
 * standing open: press the dots. Escape closes it and gives the button its
 * focus back.
 */
function topicMore(props: Partial<ComponentProps<typeof TopicMoreMenu>>) {
  return (
    <div className="flex h-[260px] justify-end p-4">
      <TopicMoreMenu
        trigger={
          <IconButton tooltip="More actions" aria-label="More actions">
            <IconDotsVertical size={16} stroke={1.5} />
          </IconButton>
        }
        onOpenDetails={noop}
        onToggleOpenWork={noop}
        onDeleteTopic={noop}
        /* Two more rows the app passes and no story did, so neither had ever
           been drawn: Copy link, and Rename (23 September). */
        onCopyLink={noop}
        onRename={noop}
        /* A topic or space in a live team offers Add someone… (TEA-6). */
        onAddSomeone={noop}
        openWorkAction="add"
        {...props}
      />
    </div>
  )
}

/** A topic not on your desk yet. */
export const TopicMore: Story = { render: () => topicMore({}) }

/**
 * Already on the desk.
 *
 * The label states the direction that will work, so the menu never offers an
 * action that is already true.
 */
export const TopicMoreOnOpenWork: Story = { render: () => topicMore({ openWorkAction: 'remove' }) }

/**
 * Somewhere deleting is not on offer.
 *
 * Nothing is greyed out — the item is simply absent, which is the same rule the
 * details dialog uses for a name you cannot change.
 */
export const TopicMoreWithoutDelete: Story = { render: () => topicMore({ onDeleteTopic: undefined }) }

/**
 * A DM's menu (DMS-6).
 *
 * One item, and it says "hide": the conversation and its history survive, and
 * opening it again brings it back. Nothing a topic has applies to a DM — no
 * details, no link, no delete — so nothing else is offered.
 */
export const TopicMoreDm: Story = {
  render: () =>
    topicMore({
      onOpenDetails: undefined,
      onToggleOpenWork: undefined,
      openWorkAction: undefined,
      onDeleteTopic: undefined,
      onAddSomeone: undefined,
      onHideDm: noop,
    }),
}

/* ── Screener "Later" menu ──────────────────────────────────────────────── */

/**
 * The Screener row's "Later" action: a button whose menu offers snooze
 * durations (In 1 hour / 3 hours / Tomorrow / In a week). Picking one returns
 * an absolute timestamp after which the item reappears. **Click "Later"** to
 * open the menu (it portals so it can escape the Desk panel's clip).
 */
export const ScreenerLater: Story = {
  render: () => <ScreenerLaterMenu onPick={noop} />,
}

/* ── The composer's two menus ───────────────────────────────────────────── */

/**
 * The list is the package's `SuggestionMenu` since UIG-31 (estiva-ui 0.45.0),
 * which the `[` and `@` extensions open against the caret through
 * `suggestionPopup`; Peek says only which rows and how each looks
 * (`referenceMenu`, `peopleMenu`). So the stories draw the same list, with the
 * same settings, against a marker standing in for the caret.
 */
function InTheShell<T>({ menu, items, query = '' }: { menu: SuggestionPopupOptions<T>; items: T[]; query?: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const caret = useCallback((el: HTMLDivElement | null) => {
    setRect(el ? el.getBoundingClientRect() : null)
  }, [])
  return (
    <div className="flex h-[560px] items-end justify-start p-4">
      <div ref={caret} className="text-body-2 text-text-secondary">
        the caret is here
      </div>
      <SuggestionMenu<T>
        rect={rect}
        ariaLabel={menu.ariaLabel}
        width={menu.width}
        maxHeight={menu.maxHeight}
        sections={menu.sections ? menu.sections(items, query) : [{ items }]}
        itemKey={menu.itemKey}
        row={menu.row}
        onSelect={noop}
      />
    </div>
  )
}

/** The caret, and nothing above it. */
function CaretAlone() {
  return (
    <div className="flex h-[560px] items-end justify-start p-4">
      <div className="text-body-2 text-text-secondary">the caret is here</div>
    </div>
  )
}

// What `[` offers in the comment box (the kit's CommentBox, its list from `referenceSections`): Files, then Messages
// (Katerina, 30 Oct), each row with the kit's icon for what it names. The sections are a fixture of that shape: a
// Ship issue and project and a Peek topic, then the messages on screen (RIC-11). The Apps and Documents sections were
// mock rows, retired on 2026-09-05, and Convex topics went with FOL-23.
const SHIP = 'b3'.repeat(32)
const FILES: CaptionedItem[] = [
  { id: 'f1', label: 'Fix the token lint on the mobile build', snippet: '', uri: `nostr:${addrToNaddr(`30851:${SHIP}:token-lint`)}`, description: 'Mobile app' },
  { id: 'f2', label: 'Mobile app', snippet: '', uri: `nostr:${addrToNaddr(`30850:${SHIP}:mobile-app`)}`, summary: 'The app people carry: sign-in, Desk and the conversation.' },
  { id: 'f3', label: 'Launch checklist for v2', snippet: '', uri: `nostr:${addrToNaddr(`30840:${SHIP}:launch-checklist`)}` },
]
const MESSAGES: ConversationMessage[] = [
  { id: 'm1', author: 'Ada Lovelace', timestamp: '9:41 AM', body: 'Build **#4821** failed again on the same step.', eventId: 'a'.repeat(64) },
  { id: 'm2', author: 'Grace Hopper', timestamp: '9:44 AM', body: 'Reverted the runner image; re-running now.', eventId: 'b'.repeat(64) },
  { id: 'm3', author: 'Ada Lovelace', timestamp: '9:52 AM', body: 'Green. Leaving the pin in place until Monday.', eventId: 'c'.repeat(64) },
]

/** Each row with the icon of what it is, from its URI (7 October). */
function referenceRowIcon(uri: string) {
  const glyph = referenceGlyphOfUri(uri)
  return glyph ? <KindIcon kind={glyph} /> : undefined
}

/** The list as the box configures it: its name, and each row's icon from the address it names. */
const REFERENCES = referenceMenu({ ariaLabel: 'References', sectionLabel: 'References', icon: <KindIcon kind="file" />, iconFor: (uri) => (uri ? referenceRowIcon(uri) : undefined) })

/* The shell opens only when there is something to draw, exactly as `[` does: a `Popover` wrapped around a menu that
   returned null is an empty box, where the old hand-built container was invisible (D47). Empty sections are not drawn. */
function files(query: string) {
  const items = [
    ...filterReferences(FILES, query).map((item) => ({ ...item, section: 'Files' })),
    ...filterReferences(MESSAGES.map(toReferenceItem), query).map((item) => ({ ...item, section: 'Messages' })),
  ]
  return <PeekDataProvider>{items.length === 0 ? <CaretAlone /> : <InTheShell menu={REFERENCES} items={items} query={query} />}</PeekDataProvider>
}

/**
 * What `[` offers: the files around, then the last few messages on screen, each
 * row with the icon of what it is. Rows are the shared `MenuItem` at its default
 * size, so a message is cut to a line too.
 */
export const Files: Story = { render: () => files('') }

/** A message is found by what was said or by who said it; a file by its title. */
export const FilesFilteredToMessages: Story = { render: () => files('ada') }

/** Nothing matches — the menu renders nothing rather than an empty box. */
export const FilesNoMatches: Story = { render: () => files('zzzz') }

/** The people list, as `@` (or `!@`) opens it. */
function Mentions({ people, isUrgent }: { people: typeof PEOPLE; isUrgent?: boolean }) {
  return <InTheShell menu={peopleMenu(!!isUrgent)} items={people.map(toMentionPerson)} />
}

/** The @-mention dropdown; the highlighted row shows the Enter hint. */
export const MentionPeople: Story = { render: () => <Mentions people={PEOPLE.slice(0, 5)} /> }

/** Triggered by !@ — same list, "Urgent mention" header. */
export const MentionUrgent: Story = { render: () => <Mentions people={PEOPLE.slice(0, 5)} isUrgent /> }

/** One match left: the list is a single row. */
export const MentionSingleMatch: Story = { render: () => <Mentions people={PEOPLE.slice(0, 1)} /> }

/**
 * The items on a topic's row in the Topics column: what you do from a list
 * (TOPI-7). The package's `NavItem` draws its own "…", so it takes the items
 * alone. Point at the row and press "…".
 */
export const TopicMenuOnATreeRow: Story = {
  render: () => (
    <div className="w-72 p-4">
      <NavItem
        href="#"
        label="A topic"
        menuLabel="More options"
        menu={
          <TopicMenuItems
            openWorkAction="add"
            onToggleOpenWork={noop}
            openWorkShortcut="Ctrl+O"
            onCopyLink={noop}
            spaceAction="mark"
            onToggleSpace={noop}
            memberAction="leave"
            onToggleMember={noop}
          />
        }
      />
    </div>
  ),
}
