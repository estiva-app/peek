import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { RenameOutcome } from '@/api'
import { FileDetailsDialog } from './FileDetailsDialog'

/**
 * A bare-file topic's details: its name, who started it, its address (FOL-33).
 *
 * `TopicDetailsDialog` for a file. Compare **Default** with **ReadOnly**: the
 * difference is one Rename button, offered when the file's manifest declares a
 * rename and absent — never disabled — when it does not. **Renaming** is the
 * state the menu's own Rename item opens into, holding the name, and
 * **Refused** is the relay's answer with somewhere to land.
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
    onRename: async (): Promise<RenameOutcome> => null,
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

/** What the menu's Rename item opens: the field already editable, holding the name. */
export const Renaming: Story = {
  args: { initialEditing: true },
}

/** The relay said no, and the dialog is where it says so: the field stays open with the new name in it. */
export const Refused: Story = {
  args: {
    initialEditing: true,
    onRename: async (): Promise<RenameOutcome> => ({ kind: 'error', message: 'The relay refused the rename: relay_membership_required.' }),
  },
  play: async () => {
    // The dialog portals out of the story root, so it is found through the body.
    const body = within(document.body)
    const field = await body.findByRole('textbox', { name: 'Name' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Folders: navigation{Enter}')
    await expect(await body.findByText('The relay refused the rename: relay_membership_required.')).toBeVisible()
  },
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
  args: { file: summarized, onSummarize: async (): Promise<RenameOutcome> => ({ kind: 'error', message: 'relay_membership_required' }) },
  play: async () => {
    // The dialog portals out of the story root, so it is found through the body.
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: 'Edit' }))
    await userEvent.type(await body.findByRole('textbox', { name: 'Summary' }), ' Today.')
    await userEvent.click(body.getByRole('button', { name: 'Save' }))
    await expect(await body.findByText('Summary not saved. relay_membership_required Your text is still here.')).toBeVisible()
  },
}
