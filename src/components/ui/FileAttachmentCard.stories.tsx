import type { Meta, StoryObj } from '@storybook/react-vite'
import type { FileAttachment } from '@/api'
import { FileAttachmentCard } from './FileAttachmentCard'

/**
 * A file on a sent message.
 *
 * Two shapes, decided by the file rather than by a prop: an **image** becomes a
 * thumbnail you can open, and everything else becomes a **row** — type tile,
 * name, and what it is. An image is its own preview; a `.docx` has nothing to
 * show, so showing a grey rectangle in place of one would be pretending.
 *
 * Both carry a download control that fades in on hover or keyboard focus and
 * keeps its slot when hidden, so revealing it never shifts the row. Hover a
 * card below to see it.
 *
 * The vocabulary is worth noting, because it is the one the reference widget
 * should be speaking too: a 36px `rounded-md` tile on `--bg-active` for what
 * the thing *is*, a 12px medium name, and a 10px secondary line underneath for
 * everything about it that is not its name.
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

const TALL = svg(
  270,
  480,
  `<rect x="40" y="60" width="190" height="190" rx="16" fill="#b18cff"/><circle cx="135" cy="370" r="70" fill="#ffc94d"/>`,
)

const file = (name: string, size = 248_000, extra: Partial<FileAttachment> = {}): FileAttachment => ({
  name,
  size,
  contentType: 'application/octet-stream',
  url: 'https://example.com/f',
  ...extra,
})

const meta = {
  title: 'Messages/File attachment',
  component: FileAttachmentCard,
  parameters: { layout: 'padded' },
  args: { file: file('Q3-billing-summary.pdf', 2_412_000) },
} satisfies Meta<typeof FileAttachmentCard>

export default meta
type Story = StoryObj<typeof meta>

/** The row: a type icon, the name, and what it is. */
export const Document: Story = {}

/**
 * An image is its own preview.
 *
 * Narrower than the file row (180px against 240px) because a thumbnail carries
 * itself, while a row has to earn its width with text.
 */
export const Image: Story = {
  args: { file: file('checkout-flow.png', 840_000, { url: WIDE, contentType: 'image/png' }) },
}

/**
 * A tall image in the same box.
 *
 * The thumbnail is a fixed 112px `object-cover` crop, so a portrait photo and a
 * screenshot sit in a row at the same height instead of a ragged line of
 * different-shaped cards. The cost is a crop, which is why the whole thing opens
 * in a lightbox.
 */
export const TallImage: Story = {
  args: { file: file('signup-screen.png', 1_180_000, { url: TALL, contentType: 'image/png' }) },
}

/**
 * **Still uploading**, or a file whose URL never resolved.
 *
 * Dimmed and inert: no link, no download. A control that cannot do anything yet
 * is worse than no control, because pressing it teaches you the card is broken.
 */
export const WithoutUrl: Story = {
  args: { file: { name: 'annual-report.pdf', size: 4_800_000, contentType: 'application/pdf' } },
}

/**
 * Every type Peek accepts, and the fallback for one it has no icon for.
 *
 * The icons come from Tabler's file-type set at 1.5 stroke, matching every
 * other icon in the app. `.heic` has no icon of its own and lands on the plain
 * file glyph rather than on a wrong one.
 */
export const EveryType: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-2">
      {[
        'proposal.pdf',
        'contract.docx',
        'forecast.xlsx',
        'kickoff.pptx',
        'export.csv',
        'notes.txt',
        'README.md',
        'manifest.json',
        'assets.zip',
        'photo.heic',
      ].map((name) => (
        <FileAttachmentCard key={name} file={file(name, 300_000)} />
      ))}
    </div>
  ),
}

/**
 * A name longer than the card.
 *
 * It truncates rather than wrapping: two lines of filename would push the size
 * line out of alignment with every other card in the row, and the full name is
 * one hover away in the download label.
 */
export const LongName: Story = {
  args: {
    file: file('2026-Q3-billing-reconciliation-and-invoice-summary-FINAL-v4.xlsx', 3_100_000),
  },
}

/**
 * Several on one message, which is the normal case.
 *
 * Images and rows wrap together in one flow. They are different widths on
 * purpose — a row of identical boxes would say the `.zip` and the screenshot are
 * the same kind of thing.
 */
export const SeveralTogether: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-2">
      <FileAttachmentCard file={file('checkout-flow.png', 840_000, { url: WIDE, contentType: 'image/png' })} />
      <FileAttachmentCard file={file('Q3-billing-summary.pdf', 2_412_000)} />
      <FileAttachmentCard file={file('raw-events.csv', 96_000)} />
    </div>
  ),
}
