import type { Meta, StoryObj } from '@storybook/react-vite'
import type { People } from '@estiva-app/interop'
import { Person } from './Person'

const KEY = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const NAMED: People = { [KEY]: { displayName: 'Amie Miles' } }

/**
 * Peek's Person draws nothing of its own; the package does. What is Peek's is
 * the lookup, so these stories are the two answers that lookup can give — and
 * the second one is drawn nowhere else in Peek's Storybook, because every
 * fixture in the app has tidy named people in it.
 */
const meta = {
  title: 'Primitives/Person',
  component: Person,
  args: { pubkey: KEY, size: 16 },
} satisfies Meta<typeof Person>

export default meta
type Story = StoryObj<typeof meta>

/** Somebody the relay has published a name for. */
export const Named: Story = {
  args: { people: NAMED },
}

/**
 * **Nobody has published a name for this key.**
 *
 * The package draws an em dash — not the key, not "Unknown", not a blank. A
 * truncated pubkey shown where a person's name belongs is FEE-1, which is why
 * the component takes a name and a picture and cannot be handed anything else.
 */
export const Unnamed: Story = {
  args: { people: {} },
}

/**
 * `people` is absent entirely in the states where nothing resolved. That is a
 * normal case, not a missing prop, and it reads the same as an unnamed key.
 */
export const NothingResolved: Story = {
  args: { people: undefined },
}

/** The two answers side by side, which is the comparison that was missing. */
export const NamedAndNot: Story = {
  render: (args) => (
    <div style={{ display: 'flex', gap: 28 }}>
      {[
        { label: 'name published', people: NAMED as People | undefined },
        { label: 'no name published', people: {} as People | undefined },
      ].map(({ label, people }) => (
        <div key={label} style={{ display: 'grid', gap: 8 }}>
          <Person {...args} people={people} />
          <span style={{ fontSize: 11, opacity: 0.6 }}>{label}</span>
        </div>
      ))}
    </div>
  ),
}
