import type { Meta, StoryObj } from '@storybook/react-vite'
import { FileDetailsDialog } from './FileDetailsDialog'

/**
 * A bare-file topic's details: its name, who started it, its address (FOL-33).
 *
 * `TopicDetailsDialog` for a file. Compare **Default** with **ReadOnly**: the
 * difference is one Rename button, offered when the file's manifest declares a
 * rename and absent — never disabled — when it does not. **Renaming** is the
 * state the menu's own Rename item opens into, and **Refused** is the relay's
 * answer with somewhere to land.
 */
const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const TOPIC = `30840:${CATH}:0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f`

const file = {
  address: TOPIC,
  slots: { title: { value: 'Folders: Universal navigation concept' } },
  people: { [CATH]: { displayName: 'Katerina Kelepouri' } },
}

const meta = {
  title: 'Folders/FileDetailsDialog',
  component: FileDetailsDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    file,
    onRename: async () => null,
    onClose: () => {},
  },
} satisfies Meta<typeof FileDetailsDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** The manifest declares no rename: a label, and nothing to try. */
export const ReadOnly: Story = {
  args: { onRename: undefined },
}

/** What the menu's Rename item opens: the field already editable. */
export const Renaming: Story = {
  args: { initialEditing: true },
}

/** The relay said no, and the dialog is where it says so. */
export const Refused: Story = {
  args: { initialEditing: true, initialError: 'The relay refused the rename: relay_membership_required.' },
}

const SUMMARY = 'Where we work out how people move between Folders, files and apps, before the navigation rework starts.'
const summarized = { ...file, slots: { ...file.slots, subtitle: { value: SUMMARY, field: 'summary' } } }

/**
 * The topic's summary (SPEC §6.12), under its name — where a topic's summary
 * is read and written, since its page shows none (the short-summary
 * prototype's *In Peek's Details*). Edit opens a field with Save and Cancel.
 */
export const WithASummary: Story = {
  args: { file: summarized, onSummarize: async () => null },
}

/** No summary yet, for someone who can edit: "Add a summary". */
export const AddASummary: Story = {
  args: { onSummarize: async () => null },
}

/** Someone who can't edit: the text alone, like the name. With none, the section is left out (ReadOnly). */
export const SummaryReadOnly: Story = {
  args: { file: summarized, onRename: undefined },
}

/** A refused summary: the field stays open with your text and the reason, and Save sends it again. */
export const SummaryRefused: Story = {
  args: { file: summarized, onSummarize: async () => null, initialSummaryError: 'relay_membership_required' },
}
