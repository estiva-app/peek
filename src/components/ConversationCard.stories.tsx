import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { ConversationCard } from './ConversationCard'

const meta = {
  title: 'Messages/ConversationCard',
  component: ConversationCard,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <MemoryRouter>
        <PeekDataProvider>
          <div className="w-[560px]">
            <Story />
          </div>
        </PeekDataProvider>
      </MemoryRouter>
    ),
  ],
  args: {
    authorName: 'Daniel Stanton',
    timestamp: '11:08 AM',
    body: 'Found the root cause — a dependency bump broke the build. Pinning it back now; will confirm once it goes green.',
  },
} satisfies Meta<typeof ConversationCard>

export default meta
type Story = StoryObj<typeof meta>

// Signal-theme reply-row data: the facepile + last-reply time only render
// under the signal theme; light/dark ignore these args entirely.
const replyRow = {
  replyAuthors: [{ name: 'Alice Johnson' }, { name: 'Jake Walter' }, { name: 'Zack Bright' }],
  lastReplyTime: '12:42 PM',
}

/** Resting card: avatar, author, time, body. Hover it to reveal the quick-action toolbar. */
export const Default: Story = {}

/**
 * **Files on a message.**
 *
 * The cards are not the same height on purpose — an image carries its own
 * preview and a `.csv` has nothing to show — so the row is top-aligned. Without
 * that, the file chips stretched to the tallest card beside them and sat with
 * their icons floating in an empty box.
 *
 * The full set of card states lives in `Messages/File attachment`.
 */
export const WithAttachments: Story = {
  args: {
    body: 'Reconciliation is done — summary and the raw export are attached, plus the checkout screen it came from.',
    files: [
      {
        name: 'checkout-flow.png',
        size: 840_000,
        contentType: 'image/png',
        url:
          'data:image/svg+xml;utf8,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270"><rect width="480" height="270" fill="#0f1720"/><circle cx="120" cy="90" r="52" fill="#56c8ff"/><rect x="196" y="150" width="220" height="70" rx="12" fill="#4ade8c"/></svg>',
          ),
      },
      { name: 'Q3-billing-summary.pdf', size: 2_412_000, contentType: 'application/pdf', url: '#' },
      { name: 'raw-events.csv', size: 96_000, contentType: 'text/csv', url: '#' },
    ],
  },
}

export const WithReactions: Story = {
  args: {
    reactions: [
      { emoji: '🙏', count: 3, owner: 'others' },
      { emoji: '🚀', count: 1, owner: 'yours' },
    ],
  },
}

export const WithReplies: Story = {
  args: { replyCount: 3, ...replyRow },
}

/** New top-level message — soft blue border + blue dot by the author's name. */
/**
 * **Edited.** "(edited)" beside the time, with when in its tooltip — the
 * reader's half of the newest-wins edit rule (CON-8, RFC 0.4 §7.2.1).
 */
export const Edited: Story = {
  args: { editedAt: Date.now() - 5 * 60_000 },
}

export const Unread: Story = {
  args: { hasNewMessage: true },
}

/** Unread reply — blue "1 new" chip next to the reply count. */
export const UnreadReply: Story = {
  args: { replyCount: 3, hasNewReply: true, ...replyRow },
}

/**
 * Urgent is a modifier of unread: paired with a new message it swaps the blue
 * treatment for amber — amber border + the alert badge instead of the dot.
 */
export const Urgent: Story = {
  args: { hasNewMessage: true, isUrgent: true },
}

/** Urgent unread reply — amber "1 new" chip. */
export const UrgentReply: Story = {
  args: { replyCount: 3, hasNewReply: true, isUrgent: true, ...replyRow },
}

/** A highlighted message wears its colored type pill in the author line. */
export const Highlight: Story = {
  args: { highlightType: 'insight' },
}

/** Resolved: green double-check banner with "resolved" and the outcome message. */
export const Resolved: Story = {
  args: {
    isResolved: true,
    resolvedBy: 'Alice',
    resolutionMessage: 'Spec updated: SDK 3.4.2 + retry shortcut. Going to QA next sprint.',
    replyCount: 4,
    ...replyRow,
  },
}

/** Selected (its thread is open) — highlighted background. */
export const Selected: Story = {
  args: { isSelected: true },
}

/** DM message that seeded a huddle — status-circle "Huddle in [Topic]" anchor (links to the topic). */
export const HuddleAnchor: Story = {
  args: {
    huddleContext: { topicId: '3', topicTitle: 'Ongoing onboarding issues' },
    authorName: 'You',
  },
}

/** Inline chips: `@`/`!@` mentions, `[Topic]`/`[File]` refs, auto-linked references. */
export const InlineTokens: Story = {
  args: {
    body:
      'Pinging @Alice Johnson and !@Greg Bothman — ties into [Ongoing onboarding issues] and [Brand guidelines 2026.pdf]. Fix is in PR #1234, tracked as PEEK-142; verify build #5102.',
    replyCount: 2,
  },
}

/**
 * Editing a sent message, and everything the composer can do.
 *
 * The edit box is a compose box, and for a long time it was not: `/` opened
 * nothing, there was no selection toolbar over a chosen word, and no
 * highlighter. All three were written into `ComposeBox` and only there. These
 * run in a browser because that is the only place typing reaches ProseMirror —
 * jsdom never mutates a contenteditable, so the unit tests beside this file
 * prove the parts that are not typing.
 */
async function startEditing(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const doc = within(canvasElement.ownerDocument.body)
  // The quick-action toolbar appears on hovering the card, which is inside the
  // decorator, not the canvas root.
  const card = canvasElement.querySelector('div.relative.rounded-lg') as HTMLElement
  await userEvent.hover(card)
  await userEvent.click(await doc.findByRole('button', { name: 'More actions' }))
  await userEvent.click(await doc.findByText('Edit message'))
  const surface = (await canvas.findByText(/Found the root cause/)).closest('.ProseMirror') as HTMLElement
  await userEvent.click(surface)
  return { canvas, doc, surface }
}

/**
 * The box itself. Paperclip, snooze and highlighter on the left, Cancel and
 * Save on the right — the composer's toolbar, minus the send button it does
 * not need.
 */
export const Editing: Story = {
  args: { authorName: 'You' },
  play: async ({ canvasElement }) => {
    const { canvas } = await startEditing(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Highlight' })).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  },
}

/**
 * `/` while editing — the thing that did nothing until 2026-09-08.
 *
 * Same three sections the composer shows, at the caret rather than at the
 * start of the box: it is a suggestion plugin, so it opens mid-sentence, which
 * is the normal case here because the message is already in the box.
 */
export const EditingSlashMenu: Story = {
  args: { authorName: 'You' },
  play: async ({ canvasElement }) => {
    const { doc } = await startEditing(canvasElement)
    await userEvent.keyboard(' /')
    await expect(await doc.findByText('Format')).toBeInTheDocument()
    await expect(doc.getByText('Shortcuts')).toBeInTheDocument()
    await expect(doc.getByText('Highlights')).toBeInTheDocument()
  },
}

/**
 * The same menu, with the message low on the screen.
 *
 * Above the caret is where these menus have always gone, and it is still the
 * preference — the story above only opens downward because the card sits at
 * the top of the canvas with nothing above it. That was the bug: every
 * type-ahead popup hung above the caret and *only* above it, which is right
 * for a composer at the foot of a topic and wrong for a message near the top
 * of the stream, where the menu was drawn off the top of the window. That
 * looks exactly like `/` doing nothing.
 */
export const EditingSlashMenuLowOnTheScreen: Story = {
  args: { authorName: 'You' },
  decorators: [Story => <div className="flex min-h-[620px] items-end"><div className="w-full"><Story /></div></div>],
  play: async ({ canvasElement }) => {
    const { doc } = await startEditing(canvasElement)
    await userEvent.keyboard(' /')
    const panel = (await doc.findByText('Format')).closest('div[class*="w-[300px]"]') as HTMLElement
    const box = canvasElement.querySelector('.ProseMirror')!.getBoundingClientRect()
    const menu = panel.getBoundingClientRect()
    // Above the caret it opened from, and wholly on screen.
    await expect(menu.bottom).toBeLessThan(box.bottom)
    await expect(menu.top).toBeGreaterThanOrEqual(0)
  },
}

/** Bold, italic, underline and link over a chosen word, while editing. */
export const EditingSelectionToolbar: Story = {
  args: { authorName: 'You' },
  play: async ({ canvasElement }) => {
    const { doc } = await startEditing(canvasElement)
    await userEvent.keyboard('{Control>}a{/Control}')
    await expect(await doc.findByRole('button', { name: 'Bold' })).toBeInTheDocument()
    await expect(doc.getByRole('button', { name: 'Link' })).toBeInTheDocument()
  },
}
