import { useCallback, useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { TOPICS } from '@/api'
import { PeekDataProvider } from '@/api'
import { SuggestionPopover } from '@/extensions/SuggestionPopover'
import { FilesMenu } from './FilesMenu'
import { filterFilesItems, type FilesMenuItem } from './filesMenuItems'
import type { ConversationMessage } from '@/lib/conversationRegistry'

/**
 * The menu draws rows and nothing else since D47 — the box, its placement and
 * its scrolling are the package `Popover`'s, which the `[` extension opens
 * against the caret. The story opens the same shell against a marker standing
 * in for the caret.
 */
function InTheShell({ children }: { children: ReactNode }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const caret = useCallback((el: HTMLDivElement | null) => {
    setRect(el ? el.getBoundingClientRect() : null)
  }, [])
  return (
    <div className="flex h-[560px] items-end justify-start p-4">
      <div ref={caret} className="text-body-2 text-text-secondary">
        the caret is here
      </div>
      <SuggestionPopover rect={rect} width="w-[658px]" maxHeight="max-h-[360px]" ariaLabel="Topics and messages">
        {children}
      </SuggestionPopover>
    </div>
  )
}

/** The caret, and nothing above it. */
InTheShell.Empty = function Empty() {
  return (
    <div className="flex h-[560px] items-end justify-start p-4">
      <div className="text-body-2 text-text-secondary">the caret is here</div>
    </div>
  )
}

// Exactly what the `[` extension offers (mention.tsx): the topics, and the
// messages on screen (RIC-11). The Apps and Documents sections were mock rows
// and were retired on 2026-09-05 — a story that shows them would be showing a
// menu the app has never rendered.
const MESSAGES: ConversationMessage[] = [
  { id: 'm1', author: 'Ada Lovelace', timestamp: '9:41 AM', body: 'Build **#4821** failed again on the same step.', eventId: 'a'.repeat(64) },
  { id: 'm2', author: 'Grace Hopper', timestamp: '9:44 AM', body: 'Reverted the runner image; re-running now.', eventId: 'b'.repeat(64) },
  { id: 'm3', author: 'Ada Lovelace', timestamp: '9:52 AM', body: 'Green. Leaving the pin in place until Monday.', eventId: 'c'.repeat(64) },
]
const ITEMS: FilesMenuItem[] = [
  ...TOPICS.map<FilesMenuItem>((t) => ({ kind: 'topic', data: t })),
  ...MESSAGES.map<FilesMenuItem>((m) => ({ kind: 'message', data: m })),
]

const meta = {
  title: 'Messages/Composer/FilesMenu',
  component: FilesMenu,
  decorators: [
    Story => (
      <PeekDataProvider>
        <Story />
      </PeekDataProvider>
    ),
  ],
  /* The shell opens only when there is something to draw, exactly as the `[`
     extension does: a `Popover` wrapped around a menu that returned null is an
     empty box, where the old hand-built container was invisible (D47). */
  render: (args) =>
    filterFilesItems(args.items, args.query).length === 0 ? (
      <InTheShell.Empty />
    ) : (
      <InTheShell>
        <FilesMenu {...args} />
      </InTheShell>
    ),
  args: {
    items: ITEMS,
    query: '',
    onSelect: () => {},
  },
  argTypes: {
    items: { control: false },
  },
} satisfies Meta<typeof FilesMenu>

export default meta
type Story = StoryObj<typeof meta>

/**
 * What `[` offers: the topics you can reference, each with its live status
 * icon, and below them the last few messages on screen, each as who said it
 * and how it opens. Rows are the shared `MenuItem` at its default size — one
 * line of text beside a 16px icon — so a message is cut to a line too.
 */
export const Default: Story = {}

/** Search mode: both sections, filtered by what you have typed. */
export const Filtered: Story = {
  args: { query: 'onboarding' },
}

/** A message is found by what was said or by who said it. */
export const FilteredToMessages: Story = {
  args: { query: 'ada' },
}

/** No conversation on screen (the composer in a DM, say): topics alone. */
export const TopicsOnly: Story = {
  args: { items: ITEMS.filter((i) => i.kind === 'topic') },
}

/** Nothing matches — the menu renders nothing rather than an empty box. */
export const NoMatches: Story = {
  args: { query: 'zzzz' },
}
