import type { Meta, StoryObj } from '@storybook/react-vite'
import { MessageBody } from './MessageBody'

const meta = {
  title: 'Messages/MessageBody',
  component: MessageBody,
  args: {
    // MessageBody takes the resolved-lookup from its caller (useTopicMutations);
    // the story supplies a stub so [Topic] chips can be shown resolved/unresolved.
    isTopicResolved: (): boolean => false,
  },
  argTypes: {
    isTopicResolved: { control: false },
  },
  decorators: [
    Story => (
      <div className="w-[480px] bg-bg-surface p-3 rounded-lg">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MessageBody>

export default meta
type Story = StoryObj<typeof meta>

/** Plain prose — a blank line splits the run into two paragraph segments. */
export const Paragraph: Story = {
  args: {
    body:
      "Found the root cause: the identity-verification service was returning 503s during morning peak hours.\n\nPinning the dependency back and re-running the build now — will confirm once it's green.",
  },
}

/** Lines beginning with `- ` (or `• `) render as a bullet list. */
export const BulletList: Story = {
  args: {
    body: 'Two options on the table:\n- Job queue with a download link\n- Pagination on the export endpoint',
  },
}

/** Lines beginning with `1. ` render as a numbered list. */
export const NumberedList: Story = {
  args: {
    body: 'Rollout plan:\n1. Ship the backoff fix to staging\n2. Verify no 429 loops for 24h\n3. Promote to production',
  },
}

/**
 * Inline chips: `@`/`!@` mentions, a `[Topic]` ref (live status icon), a `[File]`
 * ref (app icon), and auto-linked external references (PR, PEEK, build, ticket).
 */
export const InlineTokens: Story = {
  args: {
    body:
      'Pinging @Daniel Stanton and !@Alice Johnson — this ties into [Ongoing onboarding issues] and the new [Onboarding flow screens]. Fix is in PR #1234, tracked as PEEK-142; verify against build #5102 and Zendesk ticket #48821.',
  },
}

/** The same `[Topic]` chip when the topic is resolved — dashed circle → green check. */
export const ResolvedTopicChip: Story = {
  args: {
    body: 'Closing out [Ongoing onboarding issues] now — outcome captured in the resolution above.',
    isTopicResolved: () => true,
  },
}

/**
 * Inline rich text (2026-07): `**bold**`, `*italic*`, `__underline__`, and the
 * combined `***bold italic***` — markers live in the plain-text body and render
 * as styled spans. Word-internal asterisks (`2*3*4`) stay literal.
 */
export const RichTextMarks: Story = {
  args: {
    body:
      'The **launch date moved** to Friday — *tentatively*, per __legal review__. This is ***not public*** yet.\n\nMath like 2*3*4 stays literal.',
  },
}

/** `# ` headline and `## ` subheading lines, mixed with body text and a list. */
export const Headings: Story = {
  args: {
    body:
      '# Payment integration rollout\nQuick summary of where we landed.\n## Open questions\n- Do we gate refunds behind the same flag?\n- **Who owns** the retry queue?',
  },
}

/**
 * `> ` lines render as a quote block (consecutive lines merge into one).
 * The space is required — a bare `>` or mid-line `>` stays literal text.
 */
export const Quote: Story = {
  args: {
    body:
      "Replying to Honza's point:\n> I'm missing quotes\n> quotes goes here\nAgreed — and note that 5 > 3 stays literal.",
  },
}
