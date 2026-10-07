import { IconBox, IconCircleDashed, IconFile, IconListDetails, IconMessage } from '@tabler/icons-react'
import type { ReferenceGlyph } from '@/lib/fileGlyph'

const ICONS = {
  topic: IconCircleDashed,
  project: IconBox,
  issue: IconListDetails,
  file: IconFile,
  message: IconMessage,
} satisfies Record<ReferenceGlyph, unknown>

/**
 * A file's or a message's glyph as a bare icon, for a part that takes one —
 * a chip's `icon`, a list row's. The same glyphs `TopicState` draws at 16px
 * in its fixed box (Katerina, 7 October); this is for where the part brings
 * its own box and the size is its, 14px in a chip.
 */
export function GlyphIcon({ glyph, size = 14 }: { glyph: ReferenceGlyph; size?: number }) {
  const Icon = ICONS[glyph]
  return <Icon size={size} stroke={1.5} />
}
