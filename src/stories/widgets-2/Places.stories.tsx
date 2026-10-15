/**
 * Widgets 2, in Peek (WID-3): every place a link draws in Peek, by where it
 * sits (why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/where-a-link-sits-decides-how-it-draws.md).
 *
 * - In a message: a chip in a sentence, a row alone on its line, and the one
 *   file's card under it, which the author removes with ✕.
 * - In the message box: a lone link is a row as you write, and the one file's
 *   card shows under the box with its ✕, before you send. No Card button.
 * - In the panel: a file's description, with chip, row and the chip menu
 *   switching a lone link to its card in that line's place.
 * - Under "Mentioned in", in the panel's Activity.
 *
 * The widgets come from the ui kit's `concept` prerelease, one copy for every
 * app; the frames are Peek's own, redrawn from their class lists
 * (ConversationCard, ComposeBox, OverviewPanel, TopicActivity).
 * Prototype only: lives on `concept/widgets-2` and is never merged.
 */
import { Avatar, Card, IconButton, Panel, SectionHeader, Toolbar, ToolbarButton } from '@estiva-app/ui'
import {
  CardUnder,
  ChipMenu,
  ISSUE,
  MESSAGE,
  PAGE,
  PlacedDocument,
  PlacedLines,
  PlacedMessage,
  PROJECT,
  SentMessage,
  ThingIcon,
  TOPIC,
  cardFileOf,
  type Line,
  type Thing,
} from '@estiva-app/ui/widgets-2'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { IconArrowUp, IconPaperclip } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import { Chip } from '@/components/ui/Chip'
import { MetaText } from '@/components/ui/MetaText'
import { WRITING_BOX_CLASSES } from '@/components/ui/looks'
import { cn } from '@/lib/utils'

const loading = (thing: Thing): Thing => ({ ...thing, state: 'loading' })
const unavailable = (thing: Thing): Thing => ({ ...thing, state: 'unavailable' })

/** ConversationCard's normal layout: the header, then the body indented under the avatar. */
function Message({ name = 'Person Two', at = '10:42', subdued = false, children }: { name?: string; at?: string; subdued?: boolean; children: ReactNode }) {
  return (
    <Card fill={subdued ? 'none' : 'surface'} quietUntilHover className="relative">
      <div className="flex flex-col items-start px-2 pt-2">
        <div className="flex w-full items-center gap-2">
          <div className="flex shrink-0 items-center gap-2">
            <Avatar size={24} alt={name} />
            <span className="whitespace-nowrap text-body-2-strong text-text-primary">{name}</span>
            <MetaText>{at}</MetaText>
          </div>
        </div>
        <div className="w-full pb-2 pl-8 pr-2 pt-1">{children}</div>
      </div>
    </Card>
  )
}

/** The conversation's middle column. */
function Stream({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex min-h-screen w-full max-w-[720px] flex-col gap-2 px-4 py-6">{children}</div>
}

/** ComposeBox: the text, then the tools and Send on a row under it. No Card button any more. The one file's card goes under the box. */
function ComposeBox({ lines, card, onRemove, onSend }: { lines: Line[]; card?: Thing; onRemove?: () => void; onSend?: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={cn(WRITING_BOX_CLASSES, 'transition-colors focus-within:border-border-strong')}>
        <div className="relative min-h-[20px]">
          {lines.length > 0 && <PlacedLines lines={lines} />}
        </div>
        <div className="flex items-center justify-between">
          <Toolbar aria-label="Compose tools" surface={false} className="flex items-center gap-1">
            <ToolbarButton tooltip="Attach a file" aria-label="Attach a file">
              <IconPaperclip size={16} stroke={1.5} />
            </ToolbarButton>
          </Toolbar>
          <IconButton variant="primary" aria-label="Send" tooltip="Send" tooltipShortcut="Enter" disabled={!lines.length} glow={lines.length > 0} onClick={onSend}>
            <IconArrowUp size={16} stroke={1.5} />
          </IconButton>
        </div>
      </div>
      {card && <CardUnder thing={card} onRemove={onRemove} className="max-w-[480px]" />}
    </div>
  )
}

const meta = {
  title: 'Widgets 2/In Peek',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Messages as they draw: the one file's card under each, no row for that file, a chip in a sentence still drawn; two files, no card; an old `compact` message as it draws now. Hover a card you wrote for its ✕. */
export const InAMessage: Story = {
  render: () => (
    <Stream>
      <Message>
        <SentMessage lines={[['Some words before a link to ', ISSUE, ', and the sentence goes on after it.']]} />
      </Message>
      <Message name="Person One" at="10:44">
        <SentMessage lines={[['Words on the line above the link.'], PROJECT, ['Words on the line under it.']]} />
      </Message>
      <Message at="10:51">
        <SentMessage lines={[TOPIC]} />
      </Message>
      <Message name="Person One" at="10:58">
        <SentMessage lines={[MESSAGE]} />
      </Message>
      <Message at="11:02">
        <PlacedMessage lines={[['Two files, so no card: ', ISSUE, ' and the other one,'], PAGE]} />
      </Message>
      <Message name="Person One" at="Yesterday">
        <PlacedMessage lines={[['An old message, sent with a compact row for ', ISSUE, '.']]} oldCompact={[ISSUE]} />
      </Message>
    </Stream>
  ),
}

/** Still loading and not available to this reader, in a message and in the card under it. */
export const InAMessageLoading: Story = {
  render: () => (
    <Stream>
      <Message>
        <PlacedMessage lines={[['A link still loading: ', loading(ISSUE), '.']]} />
      </Message>
      <Message name="Person One">
        <PlacedMessage lines={[['A link this reader cannot open: ', unavailable(PROJECT), '.']]} />
      </Message>
    </Stream>
  ),
}

/** The message box, live: the lone link is a row as you write, its card shows under the box. ✕ takes the card away; Send puts the message above, card and all. */
export const InTheMessageBox: Story = {
  render: function Render() {
    const lines: Line[] = [['Words on the line above the link.'], ISSUE]
    const [removed, setRemoved] = useState(false)
    const [sent, setSent] = useState<boolean | null>(null)
    return (
      <Stream>
        {sent !== null && (
          <Message name="Person One" at="Now">
            <PlacedMessage lines={lines} removed={sent} />
          </Message>
        )}
        {sent !== null ? (
          <ComposeBox lines={[]} />
        ) : (
          <ComposeBox lines={lines} card={removed ? undefined : cardFileOf(lines)} onRemove={() => setRemoved(true)} onSend={() => setSent(removed)} />
        )}
      </Stream>
    )
  },
}

/** The message box after ✕, and with a second file linked: no card either way. */
export const InTheMessageBoxNoCard: Story = {
  render: () => (
    <Stream>
      <ComposeBox lines={[['Words before a link to ', ISSUE, ', the card removed with ✕.']]} />
      <ComposeBox lines={[['Words before a link to ', ISSUE, ' and the second one:'], PROJECT]} />
    </Stream>
  ),
}

/** After sending, as the author sees it: the card with its ✕ on hover; and after the author's ✕. */
export const SentAsTheAuthor: Story = {
  render: () => (
    <Stream>
      <Message name="Person One" at="Now">
        <PlacedMessage lines={[['Words on the line above the link.'], ISSUE]} onRemove={() => {}} />
      </Message>
      <Message name="Person One" at="Now">
        <PlacedMessage lines={[['Words on the line above the link.'], ISSUE]} removed />
      </Message>
    </Stream>
  ),
}

const DESCRIPTION: Line[] = [
  ['Some words before a link to ', PROJECT, ', and the sentence goes on after it, as a chip.'],
  ISSUE,
  ['A line of words with no link at all, between the rows.'],
  TOPIC,
  PAGE,
]

/** OverviewPanel: the file's card with its description, then Activity. */
function Overview({ children, activity }: { children: ReactNode; activity?: ReactNode }) {
  return (
    <div className="flex h-screen justify-end">
      <div className="flex w-[420px] flex-col border-l border-border-default">
        <Panel title="Overview" bodyClassName="flex flex-col pb-4">
          <div className="px-4 pb-2 pt-3">
            <Card fill="surface" className="flex flex-col gap-3 p-3">
              <div className="flex items-center gap-2">
                <ThingIcon kind="issue" />
                <span className="truncate text-body-2-strong text-text-primary">Item two</span>
              </div>
              {children}
            </Card>
          </div>
          {activity}
        </Panel>
      </div>
    </div>
  )
}

/** A file's description in Peek's panel: chips in sentences, a row for each link alone on its line. Click a row for its menu, then choose Card: it takes that line's place. */
export const InThePanel: Story = {
  render: () => (
    <Overview>
      <PlacedDocument lines={DESCRIPTION} />
    </Overview>
  ),
}

/** The chip menu on a lone-line link in the panel's description, and a card switched to in another line's place. */
export const InThePanelChipMenu: Story = {
  render: () => (
    <Overview>
      <PlacedLines
        lines={[['Words before the link.'], ISSUE, ['Words between.'], PROJECT, ['Words after.']]}
        cards={[3]}
        onLink={() => {}}
        under={(i) =>
          i === 1 ? (
            <div className="absolute left-0 top-full z-10 mt-1">
              <ChipMenu thing={ISSUE} />
            </div>
          ) : null
        }
      />
    </Overview>
  ),
}

/** "Mentioned in", the panel's Activity: TopicActivity's mention row, its card subdued, its links drawn the same way. */
export const MentionedIn: Story = {
  render: () => (
    <Overview
      activity={
        <div className="flex flex-col">
          <div className="px-2 pt-4">
            <SectionHeader title="Activity" count={2} />
          </div>
          <div className="flex flex-col gap-3 px-4 pb-4 pt-1">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Chip type="neutral" label="Mentioned in" />
                <span className="truncate text-caption text-text-muted">Group one</span>
              </div>
              <Message subdued>
                <PlacedMessage lines={[['Some words before a link to ', ISSUE, ', and the sentence goes on after it.']]} />
              </Message>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Chip type="neutral" label="Mentioned in" />
                <span className="truncate text-caption text-text-muted">Place one</span>
              </div>
              <Message name="Person One" at="Yesterday" subdued>
                <PlacedMessage lines={[['Two links: ', ISSUE, ' and'], PAGE]} />
              </Message>
            </div>
          </div>
        </div>
      }
    >
      <PlacedLines lines={[['A description with a link to ', PROJECT, '.']]} />
    </Overview>
  ),
}
