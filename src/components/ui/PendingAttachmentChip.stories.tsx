import type { Meta, StoryObj } from '@storybook/react-vite'
import { PendingAttachmentChip } from './PendingAttachmentChip'

/**
 * A file already picked, not yet sent.
 *
 * It is the composer's half of the file story: the card on a sent message is
 * *File attachment*, and this is what stands in its place while the file is
 * still on its way. The two share a vocabulary — a 36px `rounded-md` tile on
 * `--bg-active`, a 12px medium name, a 10px secondary line for everything that
 * is not the name — and differ in what that second line says: a size when the
 * file is ready, `Uploading…` while it is not, and the reason when it failed.
 *
 * A pasted screenshot arrives here named after the moment it was pasted
 * (PEE-20); a picked file keeps the name it had.
 */
const svg = (w: number, h: number, body: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#0f1720"/>${body}</svg>`,
  )}`

/** Stands in for a screenshot — no real data in a story. */
const SHOT = svg(
  480,
  270,
  `<rect x="24" y="24" width="200" height="80" rx="10" fill="#56c8ff"/><rect x="24" y="128" width="320" height="26" rx="8" fill="#39414f"/><rect x="24" y="172" width="240" height="26" rx="8" fill="#39414f"/><circle cx="404" cy="196" r="46" fill="#4ade8c"/>`,
)

const meta = {
  title: 'Messages/Composer/PendingAttachmentChip',
  component: PendingAttachmentChip,
  parameters: { layout: 'padded' },
  args: {
    name: 'Screenshot 2026-09-07 14-32-05.png',
    size: 248_000,
    contentType: 'image/png',
    status: 'done',
    previewUrl: SHOT,
    onRemove: () => {},
  },
} satisfies Meta<typeof PendingAttachmentChip>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A pasted screenshot, uploaded: its own thumbnail, its size, its made-up name.
 *
 * Hover it to see the remove control — a real pointer is the only thing that
 * shows it, which is why no story holds that state open.
 */
export const Ready: Story = {}

/** Nothing to preview, so the tile says what the file is instead. */
export const ReadyDocument: Story = {
  args: {
    name: 'Q3-billing-summary.pdf',
    contentType: 'application/pdf',
    size: 2_412_000,
    previewUrl: undefined,
  },
}

/** In flight. Enter is held until every chip has left this state. */
export const Uploading: Story = {
  args: { status: 'uploading', previewUrl: undefined },
}

/** The reason takes the size's place, and the border turns with it. */
export const Failed: Story = {
  args: {
    status: 'error',
    name: 'Screenshot 2026-09-07 14-32-05.tiff',
    error: "TIFF files aren't supported.",
    previewUrl: undefined,
  },
}
