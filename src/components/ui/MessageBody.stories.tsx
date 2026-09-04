import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { MessageBody } from './MessageBody'
import recorded from '@/data/recordedShipIssue.json'

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
 * ref (app icon), and a bare URL (auto-linked).
 */
export const InlineTokens: Story = {
  args: {
    body:
      'Pinging @Daniel Stanton and !@Alice Johnson — this ties into [Ongoing onboarding issues] and the new [Brand guidelines 2026.pdf]. Notes are at https://example.com/onboarding-notes.',
  },
}

/** An `@` only opens a mention at the start of a word, so an email address
 *  stays plain text while a real mention beside it still becomes a chip.
 *  Every address below used to have its domain torn out as a chip. */
export const EmailAddressesAreNotMentions: Story = {
  args: {
    body:
      'It would be nice to see katerina@estiva.estiva.app instead of my public key.\n' +
      'Others that used to break: first.last@estiva.app, support@peek-app.io, kat+peek@estiva.app, user@localhost.\n' +
      'Still a mention: @backend-team, and @Daniel Stanton — plus @testing-library/react, which was always plain.',
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

/**
 * A fence is literal by definition — no mentions, no marks, no chips — and a
 * line longer than the card scrolls sideways in the shared bar rather than
 * widening the message around it.
 */
export const CodeBlock: Story = {
  args: {
    body:
      'The failing call, for the record:\n```ts\nconst res = await relay.publish({ kind: 1111, tags: [["e", id], ["p", author], ["client", "peek"]], content })\nif (!res.ok) throw new Error(res.reason)\n```\nEverything after the closing fence is prose again.',
  },
}

/**
 * Links — PEE-19. A bare URL links to itself; `[label](url)` links its own
 * words; a bold link is bold. The form is SPEC §13.1's, written by Peek's
 * composer until the protocol package speaks it (PEE-25).
 */
export const Links: Story = {
  args: {
    body:
      'Read [the widgets topic](https://peek.estiva.app/topic/widgets) first, then **[the plan](https://example.com/plan)** — the raw form is at https://example.com/raw.',
  },
}

/**
 * A pointer written **inside a sentence**, drawn where it was written — RIC-10.
 *
 * Miky, 2026-09-02: *"Imagine mentioning project in your message in the middle
 * of sentence that shows the name, and maybe the status as icon or something."*
 *
 * The object is `recordedShipIssue.json`: a real Ship issue, resolved from 1074
 * recorded production events through Peek's own `resolveObjectAsViewer` and the
 * projection layer, then written down. Not a hand-made fixture — the title, the
 * status and its colour are what Ship's manifest actually declares for that
 * issue. `resolvedObjects` is the same seam the attachment card uses in
 * Storybook, so both variants of one object are drawn from one answer.
 *
 * The body is **the same string Ship's `ric9-live-check.ts` puts on its two
 * surfaces**, down to the relay hint inside the pointer. RIC-10's done-when
 * asks for the same body to render the same way in both apps, and the only way
 * to check that is to render the same body.
 */
export const InlineReference: Story = {
  args: {
    body: `Tracked in nostr:${recorded.naddr} for now.`,
    resolvedObjects: { [recorded.naddr]: recorded.object as unknown as ForeignObject },
  },
}

/**
 * The same object, the same message, one difference: the pointer is alone on
 * its line. It becomes a card below the text, exactly as it always did — that
 * variant is not replaced, and the position is what chooses between them.
 */
export const StandaloneReference: Story = {
  args: {
    body: `Tracked in it for now.\n\nnostr:${recorded.naddr}`,
    resolvedObjects: { [recorded.naddr]: recorded.object as unknown as ForeignObject },
  },
}
