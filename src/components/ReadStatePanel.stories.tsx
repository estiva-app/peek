import type { Meta, StoryObj } from '@storybook/react-vite'
import { SizeReadout } from './ReadStatePanel'

/**
 * The size readout from the "Read state" panel in the account menu (SHR-4).
 *
 * The panel itself reads the tab's merged frontier through a module-level store,
 * so it has nothing to show outside the running app. The readout is pure and
 * takes the numbers, which is what makes the state that matters — read state
 * being dropped to stay under the ceiling — something a person can be shown
 * rather than something they have to reach by filling a blob up.
 *
 * Wrapped at 300px, the panel's own width, because the second line is the one
 * that has to stay legible when it turns into a warning.
 */
const meta = {
  title: 'Diagnostics/Read state size',
  component: SizeReadout,
  decorators: [
    (Story) => (
      <div className="w-[300px] bg-bg-surface p-2">
        <Story />
      </div>
    ),
  ],
  args: {
    contexts: 287,
    bytes: 24379,
    pctOfCeiling: 37.2,
    ceilingBytes: 65535,
    slotBytes: undefined,
    evicted: 0,
  },
} satisfies Meta<typeof SizeReadout>

export default meta
type Story = StoryObj<typeof meta>

/** Production, measured on Miky's slot on 2026-09-16 — the number SHR-3 got. */
export const Measured: Story = {}

/** Once the queue has hydrated, this installation's own blob is named too. */
export const SlotHydrated: Story = {
  args: { slotBytes: 18004 },
}

/** Past 80 %: nothing lost yet, and the next few hundred threads will cost some. */
export const NearTheCeiling: Story = {
  args: { contexts: 690, bytes: 56180, pctOfCeiling: 85.7, slotBytes: 56180 },
}

/** The state the cap exists for — the blob is full and the oldest markers went. */
export const Evicting: Story = {
  args: { contexts: 771, bytes: 65460, pctOfCeiling: 99.9, slotBytes: 65460, evicted: 14 },
}

/** One dropped marker still reads as English. */
export const EvictedOne: Story = {
  args: { contexts: 771, bytes: 65460, pctOfCeiling: 99.9, slotBytes: 65460, evicted: 1 },
}
