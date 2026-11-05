import type { Meta, StoryObj } from '@storybook/react-vite'
import { IntelligenceNext } from './IntelligenceNext'

/**
 * The next Intelligence box. Search stays a search until the sentence is a
 * prompt. A file grows a preview. Escape keeps an unfinished sentence, and a
 * dot on the top-bar search shows work that is still going, or an answer
 * waiting.
 */
const meta = {
  title: 'Intelligence/Next',
  component: IntelligenceNext,
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '720px' } },
  },
} satisfies Meta<typeof IntelligenceNext>

export default meta
type Story = StoryObj<typeof meta>

/** Type. Three words grows the field. Enter asks. Escape keeps the sentence; open the search again and it is still there. */
export const TryIt: Story = {}

/** A file is highlighted, so the pane shows enough to know it is the right one. A topic or a person in the same list has no pane. */
export const AFile: Story = { args: { query: 'leaf', litId: 'leaf' } }

/** The sentence is a prompt: the field has grown, the topic's files stay as reference, and two actions are suggested. */
export const APrompt: Story = { args: { query: "what's the latest on this" } }

/** Hidden while it works. The dot on the search control is the only sign. Click the search to bring the box back. */
export const Working: Story = { args: { hidden: true, phase: 'working', hold: true, query: "what's the latest on this" } }

/** The answer, with the same two actions. Closing it leaves the solid dot, so the answer is one click away. */
export const TheAnswer: Story = { args: { phase: 'answered', query: "what's the latest on this" } }
