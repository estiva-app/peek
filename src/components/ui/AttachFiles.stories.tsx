import type { Meta, StoryObj } from '@storybook/react-vite'
import { AttachmentChips } from './AttachFiles'

/**
 * The row of files under an edit box — PEE-16.
 *
 * Editing a sent message can now add a file and remove one, so the box needs
 * somewhere to show both at once: the files the message already has, and the
 * ones just picked or pasted, which may still be uploading. They are the same
 * chip either way, deliberately — while the box is open there is no useful
 * difference between a file that is already on the message and one that will
 * be when it is saved.
 *
 * The paperclip that fills this row is in the same file and has no story: it
 * renders only against a live backend, since an upload needs storage, so in
 * Storybook it is correctly nothing at all.
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
  title: 'To be removed/AttachmentChips',
  component: AttachmentChips,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof AttachmentChips>

export default meta
type Story = StoryObj<typeof meta>

/** What the message already carries, on opening the editor. */
export const MessageFiles: Story = {
  args: {
    chips: [
      { key: 'a', name: 'Q3 brief.pdf', size: 248_000, contentType: 'application/pdf', status: 'done', onRemove: () => {} },
      { key: 'b', name: 'chart.png', size: 96_400, contentType: 'image/png', status: 'done', previewUrl: SHOT, onRemove: () => {} },
    ],
  },
}

/**
 * Mid-edit: two files the message had, one pasted screenshot on its way, one
 * that will not arrive. The row does not sort or group them — they sit in the
 * order they were attached, which is the order they were thought of.
 */
export const Mixed: Story = {
  args: {
    chips: [
      { key: 'a', name: 'Q3 brief.pdf', size: 248_000, contentType: 'application/pdf', status: 'done', onRemove: () => {} },
      { key: 'b', name: 'chart.png', size: 96_400, contentType: 'image/png', status: 'done', previewUrl: SHOT, onRemove: () => {} },
      { key: 'c', name: 'Screenshot 2026-09-07 14-32-05.png', size: 248_000, contentType: 'image/png', status: 'uploading', onRemove: () => {} },
      { key: 'd', name: 'recording.mov', size: 84_000_000, contentType: 'video/quicktime', status: 'error', error: 'Files must be under 25 MB.', onRemove: () => {} },
    ],
  },
}

/** Nothing attached: the row is not there at all, not an empty space. */
export const Empty: Story = { args: { chips: [] } }
