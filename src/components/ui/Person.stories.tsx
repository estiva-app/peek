import type { Meta, StoryObj } from '@storybook/react-vite'
import { Person } from './Person'

/**
 * A person named on another app's object.
 *
 * Ship says an issue is assigned to `a8a7d739dda5…` — a manifest declares that
 * a slot holds a pubkey, never whose. Peek used to print the first eight
 * characters of it, which nobody recognises a colleague by and which read as a
 * bug rather than a value (FEE-1).
 *
 * The name and face come from the person's kind:0 profile, published by Estiva
 * ID and resolved alongside the object it belongs to. Resolving them together
 * is what lets the widget's own skeleton cover the wait: there is no moment
 * where a key is on screen waiting to be replaced by a name.
 */
const PERSON = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'

const meta = {
  title: 'Primitives/Person',
  component: Person,
  parameters: { layout: 'padded' },
  args: { pubkey: PERSON },
} satisfies Meta<typeof Person>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The ordinary case: a name and a face.
 *
 * The relay holds no picture for this one, so `Avatar` falls back to the
 * portrait Peek already has for someone of that name — which is how a Ship
 * teammate who is also a Peek member keeps one face across both.
 */
export const Default: Story = {
  args: { people: { [PERSON]: { displayName: 'Amie Miles' } } },
}

/** A picture published on the relay wins, whoever the owning app was. */
export const WithPublishedPicture: Story = {
  args: {
    people: {
      [PERSON]: {
        displayName: 'Amie Miles',
        picture:
          'data:image/svg+xml;utf8,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="%234ade8c"/><circle cx="16" cy="12" r="6" fill="%23fff"/><circle cx="16" cy="30" r="11" fill="%23fff"/></svg>`,
          ),
      },
    },
  },
}

/**
 * **Nobody has published a name for them.**
 *
 * Rare, since Estiva ID writes a profile at signup — but the key must not come
 * back when it happens. The silhouette says there is somebody here; the em dash
 * says we cannot name them, and it is the mark the Files panel already uses for
 * a property with no value.
 */
export const Unnamed: Story = {
  args: { people: {} },
}

/**
 * A long name in a narrow column, which is where the Files panel puts it.
 *
 * The name truncates and the face never shrinks — a squashed avatar reads as a
 * rendering fault, while a clipped name plainly reads as a clipped name.
 */
export const LongName: Story = {
  args: { people: { [PERSON]: { displayName: 'Alexandra Konstantinopoulou-Fairbairn' } } },
  decorators: [
    (Story) => (
      <div className="w-[140px] border border-border-subtle p-2">
        <Story />
      </div>
    ),
  ],
}
