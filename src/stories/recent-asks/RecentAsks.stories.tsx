import type { Meta, StoryObj } from '@storybook/react-vite'
import { RecentAsks, SAMPLE_ASKS } from './RecentAsks'

/**
 * KIN-8 — in Peek's ⌘K, Recent lists the asks you made in this tab.
 *
 * Ask something, move to another conversation, press Ctrl+K: the box opens
 * fresh, about where you are, and what you asked waits under Recent with where
 * you asked it. Picking it brings back the sentence and its answer. A dot on a
 * row means it is still being worked on (pulsing) or its answer is unseen
 * (solid). Only you forget one (Ctrl+Backspace on its row, or Clear recent);
 * a reload forgets them all.
 */
const meta = {
  title: 'Concept/KIN-8 Recent asks',
  component: RecentAsks,
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '720px' } },
  },
} satisfies Meta<typeof RecentAsks>

export default meta
type Story = StoryObj<typeof meta>

/** Try it: Ctrl+K, type a sentence of three words or more, Enter. Hide it, pick another conversation on the left, Ctrl+K again. */
export const TryIt: Story = { args: { open: false } }

/** You asked in Intelligence in Peek and moved to Weekly sync. The box is about Weekly sync; your ask waits under Recent, answer already seen, so no dot. */
export const FreshBoxElsewhere: Story = {
  args: { at: 'Weekly sync', asks: [SAMPLE_ASKS.seen] },
}

/** An answer came while you were elsewhere: the search carries the solid dot. Click it — the box opens fresh, with the waiting ask lit first. */
export const AnswerWaiting: Story = {
  args: {
    at: 'Weekly sync',
    asks: [SAMPLE_ASKS.seen, SAMPLE_ASKS.waiting],
    open: false,
  },
}

/** Several at once: one still being worked on (pulsing dot), one waiting unseen (solid), one seen (no mark). */
export const SeveralAsks: Story = {
  args: {
    at: 'Intelligence in Peek',
    asks: [SAMPLE_ASKS.working, SAMPLE_ASKS.waiting, SAMPLE_ASKS.seen],
  },
}

/** Picked from Recent: the sentence and its answer, about the conversation it was asked in, with what you can do with it. Using the answer leaves the ask under Recent. */
export const PickedFromRecent: Story = {
  args: {
    at: 'Weekly sync',
    asks: [SAMPLE_ASKS.waiting, SAMPLE_ASKS.seen],
    showing: 'a2',
  },
}

/** Back in the conversation you asked in: Ctrl+K shows the ask as it does today. */
export const SamePlace: Story = {
  args: {
    at: 'Website launch',
    asks: [SAMPLE_ASKS.waiting],
    showing: 'a2',
    open: false,
  },
}
