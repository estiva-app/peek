import type { Meta, StoryObj } from '@storybook/react-vite'
import { PICKER_FOLDERS, SHIP_PROJECT } from '@/api/fixtures'
import { StartTopicDialog } from './StartTopicDialog'

const noop = () => {}

/**
 * Starting a topic on a bare file, SPEC §6.7 (RFC 0.5 §10.7).
 *
 * Three cases shape the component and all three are here: a topic at the top of
 * a Folder, one started from a row, which sits *under* that file, and one
 * started from the column header with no Folder in hand.
 */
const meta = {
  title: 'Topics/StartTopicDialog',
  component: StartTopicDialog,
  parameters: {
    layout: 'fullscreen',
    docs: { story: { inline: false, height: '560px' } },
  },
  args: {
    folderName: 'Folders',
    onCreate: async () => true,
    onClose: noop,
  },
} satisfies Meta<typeof StartTopicDialog>

export default meta
type Story = StoryObj<typeof meta>

/** A topic at the top of the Folder — no parent, no `a` tag. */
export const InAFolder: Story = {}

/** With its optional summary filled in (SPEC §6.12): seeded on the topic as it is started. */
export const WithASummary: Story = {
  args: { initialTitle: 'Launch naming', initialSummary: 'Where we pick the product’s name, by Friday.' },
}

/** Past about 240 characters a count takes the helper's place; nothing is refused. */
export const ALongSummary: Story = {
  args: {
    initialTitle: 'Launch naming',
    initialSummary:
      'Where we pick the product’s name, by Friday: the shortlist, the domain checks, the trademark search, who signs off and when, ' +
      'what each name says to a customer who has never heard of us, and the reasons the last three candidates lost to the ones still standing.',
  },
}

/**
 * Started from a Ship project's row. The dialog names the parent and says what
 * follows from it, because a person choosing "under" is choosing where Ship
 * will show it too.
 */
export const UnderAFile: Story = {
  args: { parent: SHIP_PROJECT },
}

/**
 * The third case, and the one FOL-41 added: started from the column header,
 * where there is no Folder in hand. The dialog asks — a second field, the same
 * `Select` as `MoveDialog`'s and for the same reason — and the sentence
 * above names whichever Folder is chosen, so it changes as the picker does.
 *
 * What the old Start topic dialog asks for second is people to invite. That one
 * makes a Convex topic, whose membership is its own; a bare file has no invitee
 * list on the wire, and its readers are the Folder's — which is what this field
 * decides.
 */
export const ChoosingAFolder: Story = {
  args: { folderName: undefined, folders: PICKER_FOLDERS },
}

/**
 * Nowhere to start one. The same rule as `MoveDialog`'s empty case: a
 * picker with no rows is an action that cannot succeed, so the dialog says so
 * instead of drawing one.
 */
export const WithNoFolders: Story = {
  args: { folderName: undefined, folders: [] },
}
