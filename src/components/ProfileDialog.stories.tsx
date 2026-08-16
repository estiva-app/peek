import type { Meta, StoryObj } from '@storybook/react-vite'
import { PeekDataProvider } from '@/api'
import { ProfileDialog } from './ProfileDialog'

/**
 * Your profile as Peek sees it — read-only since PEEK-42. Estiva ID owns the
 * name, role and photo, publishes them as `kind:0`, and Peek reads them back
 * off the relay, so the only action here is a link out to id.estiva.app.
 *
 * It used to edit all three into Peek's own row, which made two writers for one
 * profile — the state PEEK-31 removed everywhere else. The visible symptom was
 * an avatar uploaded in Peek outranking the published one.
 *
 * In Storybook (mock mode) the current user is the fixture "You" with no
 * avatar, so this renders the name, the silhouette and the link.
 */
const meta = {
  title: 'Navigation/ProfileDialog',
  component: ProfileDialog,
  parameters: {
    layout: 'fullscreen',
    // Portals a fixed overlay to document.body — iframe it in Docs.
    docs: { story: { inline: false, height: '560px' } },
  },
  decorators: [
    Story => (
      <PeekDataProvider>
        <Story />
      </PeekDataProvider>
    ),
  ],
  args: { onClose: () => {} },
} satisfies Meta<typeof ProfileDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
