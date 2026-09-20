import type { Meta, StoryObj } from '@storybook/react-vite'
import type { FileAttachment } from '@/api'
import { FileAttachmentCard } from './FileAttachmentCard'

/**
 * A file on a sent message — **what Peek adds to the package's card**.
 *
 * Every shape a file can take (a document row, an image, a long name, several
 * together, every type, no address) is the package's `AttachmentCard` and is
 * drawn on its own page: **estiva-ui → Components → AttachmentCard**, 14
 * stories. Repeating them here with Peek's data showed the same card twice
 * (Katerina, 20 September).
 *
 * What is Peek's, and only here: fetching a file another app put on the relay,
 * with the viewer's own authorization, and opening a picture full screen.
 */
const svg = (w: number, h: number, body: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#0f1720"/>${body}</svg>`,
  )}`

const WIDE = svg(
  480,
  270,
  `<circle cx="120" cy="90" r="52" fill="#56c8ff"/><rect x="196" y="150" width="220" height="70" rx="12" fill="#4ade8c"/>`,
)

const meta = {
  title: 'Messages/File attachment',
  component: FileAttachmentCard,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof FileAttachmentCard>

export default meta
type Story = StoryObj<typeof meta>

/**
 * **Press the picture.**
 *
 * It opens full screen over the page, with the ✕ in the corner; Escape or a
 * press outside closes it. The thumbnail is a 112px crop, so the full picture
 * is only visible this way — which is the reason the viewer exists.
 *
 * Peek's own, for now: it becomes the package's `Lightbox` at migration stage 7
 * (ADOPTION B22), and the escape note in the file says so.
 */
export const OpenAPictureFullScreen: Story = {
  args: {
    file: { name: 'checkout-flow.png', size: 840_000, url: WIDE, contentType: 'image/png' },
  },
}

/**
 * **A file from another app**, which has a relay path and no bytes here (CON-12).
 *
 * Peek asks the relay for it with the viewer's own authorization, so a plain
 * `<img>` cannot draw it: it is a request, with a wait and a way to fail. The
 * card says which, rather than leaving a gap where a person would read "the
 * sender forgot the file".
 *
 * Nobody is signed in inside Storybook, so the request is refused here and you
 * see the **cannot be read** card. In the app the loading card shows first, and
 * the likeliest refusal is a real answer — a channel this viewer is not in.
 */
export const AFileFromAnotherApp: Story = {
  args: {
    file: {
      name: 'relay-screenshot.png',
      size: 620_000,
      contentType: 'image/png',
      mediaUrl: 'https://relay.example/media/9f2c',
    } as FileAttachment,
  },
}
