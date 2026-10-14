import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject } from '@estiva-app/interop'
import { addrToNaddr, encodeNevent } from '@estiva-app/protocol'
import { MessageBody } from './MessageBody'
import { RECORDED_SHIP_ISSUE as recorded } from '@/api/fixtures'

// A topic and a message as interop resolves them through Peek's manifest
// (src/nostr/manifest.ts): a kind:39000 titled from its `name` tag, and a
// kind:9 titled by its author's pubkey with the content as `body`.
const RELAY_KEY = 'f3a38fa6c6a1e5d2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081920'
const ADA = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const TOPIC_ADDRESS = `39000:${RELAY_KEY}:b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91`
const TOPIC_NADDR = addrToNaddr(TOPIC_ADDRESS, [])
const TOPIC_OBJECT = {
  ref: TOPIC_ADDRESS,
  eventId: 'e'.repeat(64),
  address: TOPIC_ADDRESS,
  naddr: TOPIC_NADDR,
  kind: 39000,
  widget: 'card',
  appName: 'Peek',
  slots: { title: { value: 'Office layout (renamed)' } },
  meta: [],
  comments: [],
  actions: [],
  viaRecommendation: true,
} as unknown as ForeignObject
const MESSAGE_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff'
const MESSAGE_NEVENT = encodeNevent({ id: MESSAGE_ID, relays: [], kind: 9 })
const MESSAGE_OBJECT = {
  ref: MESSAGE_NEVENT,
  eventId: MESSAGE_ID,
  kind: 9,
  widget: ['message', 'card'],
  appName: 'Peek',
  slots: {
    title: { value: ADA, isPubkey: true },
    body: { value: 'Green. Leaving the **pin** in place until Monday.' },
  },
  people: { [ADA]: { displayName: 'Ada Lovelace' } },
  meta: [],
  comments: [],
  actions: [],
  viaRecommendation: true,
} as unknown as ForeignObject

const meta = {
  title: 'Writing & text/MessageBody',
  component: MessageBody,
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
 * Inline chips: `@`/`!@` mentions, a `[File]` ref (file icon), and a bare URL
 * (auto-linked).
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
 * its line. It reads as its chip there too (OPT-18): a card is drawn only when
 * the author chose one (SPEC §13.6.2), never for where the pointer sits.
 */
export const StandaloneReference: Story = {
  args: {
    body: `Tracked in it for now.\n\nnostr:${recorded.naddr}`,
    resolvedObjects: { [recorded.naddr]: recorded.object as unknown as ForeignObject },
  },
}

/**
 * A topic mentioned mid-sentence (RIC-11). The chip is `Reference` drawing a
 * kind:39000 the runtime resolved, so the label is the topic's *current*
 * name — the body carries only its address, and a rename reaches every
 * older message that pointed at it. The object here is the shape interop
 * hands back for one, through Peek's own manifest.
 */
export const InlineTopicMention: Story = {
  args: {
    body: `We settled this in nostr:${TOPIC_NADDR} last week.`,
    resolvedObjects: { [TOPIC_NADDR]: TOPIC_OBJECT },
  },
}

/**
 * A message mentioned mid-sentence (RIC-11). A message has no title of its
 * own, so the manifest titles it by its author — a pubkey, and `Reference`
 * names the person and quotes the opening words rather than printing 64 hex
 * characters. The pointer is an `nevent`, not an address: a message is an
 * event, and it is fetched by id.
 */
export const InlineMessageMention: Story = {
  args: {
    body: `As nostr:${MESSAGE_NEVENT} said, the pin stays until Monday.`,
    resolvedObjects: { [MESSAGE_NEVENT]: MESSAGE_OBJECT },
  },
}

/** The same message, alone on its line: its chip, as mid-sentence (OPT-18). */
export const StandaloneMessageMention: Story = {
  args: {
    body: `This is the one I meant.\n\nnostr:${MESSAGE_NEVENT}`,
    resolvedObjects: { [MESSAGE_NEVENT]: MESSAGE_OBJECT },
  },
}
