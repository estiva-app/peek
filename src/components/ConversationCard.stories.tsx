import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { ConversationCard } from './ConversationCard'

const noop = () => {}

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
    /*
      The hover strip draws Reply only when a caller hands over `onReply`
      (`ConversationQuickMenu`, line 95). The app always does; no story here
      ever did, so every card in Storybook lost an action the real one has
      (Katerina, 22 September; fixed 23 September).
    */
    onReply: noop,
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
        previewUrl:
          'data:image/svg+xml;utf8,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270"><rect width="480" height="270" fill="#0f1720"/><circle cx="120" cy="90" r="52" fill="#56c8ff"/><rect x="196" y="150" width="220" height="70" rx="12" fill="#4ade8c"/></svg>',
          ),
      },
      { name: 'Q3-billing-summary.pdf', size: 2_412_000, contentType: 'application/pdf', previewUrl: '#' },
      { name: 'raw-events.csv', size: 96_000, contentType: 'text/csv', previewUrl: '#' },
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

/**
 * **Deleted, replies kept** (PER-24). Deleting a comment deletes that event
 * only, so its replies stay: the card says so in place of the author and
 * body, offers nothing to act on, and still opens its thread.
 */
export const DeletedWithReplies: Story = {
  args: { deleted: true, authorName: '', body: '', replyCount: 2, ...replyRow },
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
 * The box itself: the shared box's edit form (PEEKM-4). Only its keys on the
 * left — no paperclip, no highlighter (Decided 2026-10-17) — and Cancel and
 * Save on the right.
 */
export const Editing: Story = {
  args: { authorName: 'You' },
  play: async ({ canvasElement }) => {
    const { canvas } = await startEditing(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Highlight' })).not.toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  },
}
