import { useCallback, useState, type ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconDotsVertical } from '@tabler/icons-react'
import { ToolbarButton } from '@estiva-app/ui'
import { PEOPLE, PeekDataProvider } from '@/api'
import { SuggestionMenu } from '@estiva-app/ui'
import type { SuggestionPopupOptions } from '@estiva-app/ui/editor'
import type { ConversationMessage } from '@/lib/conversationRegistry'
import { ConversationMoreMenu } from './ConversationMoreMenu'
import { ConversationQuickMenu } from './ConversationQuickMenu'
import { ScreenerLaterMenu } from './ScreenerLaterMenu'
import { NavItem } from '@estiva-app/ui'
import { IconButton } from './ui/IconButton'
import { TopicMenuItems, TopicMoreMenu } from './ui/TopicMoreMenu'
import { FILES_MENU, toReferenceItem } from './ui/FilesMenu'
import { filterReferences, type CaptionedItem } from '@estiva-app/ui/editor'
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
      onHideDm: noop,
    }),
}

/* ── Conversation more menu ─────────────────────────────────────────────── */

/* The menu owns its ⋯ button now, so a canvas would otherwise be one button.
   Held open, which is what these canvases are for; in the app it opens on a
   press and closes on Escape or an outside press. */
function conversationMore(props: Partial<ComponentProps<typeof ConversationMoreMenu>>) {
  return (
    <ConversationMoreMenu
      open
      isResolved={false}
      onHighlight={noop}
      onResolve={noop}
      onReopen={noop}
      onOpenWork={noop}
      onEditMessage={noop}
      onViewDetails={noop}
      onDelete={noop}
      {...props}
    />
  )
}

/**
 * Somebody else's DM message: Resolve · Open work · Mark as Highlight, then
 * View details — no Edit, no Delete. Hover "Mark as Highlight" to open the
 * 5-type submenu. "Start topic" went with the Convex topics (FOL-23).
 */
export const ConversationMoreDmMessage: Story = { render: () => conversationMore({}) }

/**
 * Your own message adds Edit message above View details and Delete below the
 * rule. PEE-32 put the authorship gate back that CON-3 and CON-8 had removed:
 * the relay refuses a non-author anyway, so the control everyone saw could not
 * succeed on anybody else's message.
 */
export const ConversationMoreOwnMessage: Story = { render: () => conversationMore({ isOwnMessage: true }) }

/** When resolved, "Resolve →" becomes "Reopen". */
export const ConversationMoreResolved: Story = { render: () => conversationMore({ isResolved: true }) }

/** With a highlight set, the row reads "Change highlight" and the submenu gains Remove. */
export const ConversationMoreWithHighlight: Story = {
  render: () => conversationMore({ currentHighlight: 'insight' }),
}

/* ── Conversation quick menu ────────────────────────────────────────────── */

/* The ⋯ menu owns its own button, so the strip takes the menu rather than a
   callback and the button arrives with it. Press it. */
const more = (
  <ConversationMoreMenu
    trigger={
      <ToolbarButton tooltip="More actions" aria-label="More actions">
        <IconDotsVertical size={16} stroke={1.5} />
      </ToolbarButton>
    }
    onDelete={noop}
  />
)

function quick(isResolved: boolean) {
  return (
    <ConversationQuickMenu
      isResolved={isResolved}
      onReact={noop}
      onReply={noop}
      onResolve={noop}
      onReopen={noop}
      more={more}
    />
  )
}

/** The hover toolbar on an open conversation card: React · Reply · Resolve · More. */
export const ConversationQuickUnresolved: Story = { render: () => quick(false) }

/** Once resolved, the middle action flips to Reopen (dashed circle). */
export const ConversationQuickResolved: Story = { render: () => quick(true) }

/** The two side by side. */
export const ConversationQuickBothStates: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      {quick(false)}
      {quick(true)}
    </div>
  ),
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
 * (`FILES_MENU`, `peopleMenu`). So the stories draw the same list, with the
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

// Exactly what the `[` extension offers (mention.tsx): the messages on screen
// (RIC-11). The Apps and Documents sections were mock rows and were retired on
// 2026-09-05 — a story that shows them would be showing a menu the app has
// never rendered — and topics went with Convex (FOL-23).
const MESSAGES: ConversationMessage[] = [
  { id: 'm1', author: 'Ada Lovelace', timestamp: '9:41 AM', body: 'Build **#4821** failed again on the same step.', eventId: 'a'.repeat(64) },
  { id: 'm2', author: 'Grace Hopper', timestamp: '9:44 AM', body: 'Reverted the runner image; re-running now.', eventId: 'b'.repeat(64) },
  { id: 'm3', author: 'Ada Lovelace', timestamp: '9:52 AM', body: 'Green. Leaving the pin in place until Monday.', eventId: 'c'.repeat(64) },
]
const ITEMS: CaptionedItem[] = MESSAGES.map(toReferenceItem)

/* The shell opens only when there is something to draw, exactly as the `[`
   extension does: a `Popover` wrapped around a menu that returned null is an
   empty box, where the old hand-built container was invisible (D47). */
function files(items: CaptionedItem[], query: string) {
  return (
    <PeekDataProvider>
      {filterReferences(items, query).length === 0 ? (
        <CaretAlone />
      ) : (
        <InTheShell menu={FILES_MENU} items={filterReferences(items, query)} query={query} />
      )}
    </PeekDataProvider>
  )
}

/**
 * What `[` offers: the last few messages on screen, each as who said it and
 * how it opens. Rows are the shared `MenuItem` at its default size — one
 * line of text beside a 16px icon — so a message is cut to a line too.
 */
export const Files: Story = { render: () => files(ITEMS, '') }

/** A message is found by what was said or by who said it. */
export const FilesFilteredToMessages: Story = { render: () => files(ITEMS, 'ada') }

/** Nothing matches — the menu renders nothing rather than an empty box. */
export const FilesNoMatches: Story = { render: () => files(ITEMS, 'zzzz') }

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
 * The same items on a tree row of the Folders column: the package's `NavItem`
 * draws its own ⋮, so it takes the items alone. Point at the row and press ⋮.
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
            onOpenDetails={noop}
            onRename={noop}
            onNewSubTopic={noop}
            onMove={noop}
            onCopyLink={noop}
            openWorkAction="add"
            onToggleOpenWork={noop}
            memberAction="join"
            onToggleMember={noop}
            onHideDm={noop}
            archiveAction="archive"
            onToggleArchive={noop}
            onDeleteTopic={noop}
          />
        }
      />
    </div>
  ),
}
