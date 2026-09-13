import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/**
 * The chip a word becomes in a message: a `[Topic]`, a `[file]`, an `@person`,
 * a message quoted mid-sentence, a highlight. One shape, written once.
 *
 * **Why this file exists.** The same class list was typed eleven times: three
 * in `MessageBody` (the reader), eight in `extensions/mention.tsx` and
 * `extensions/highlight.tsx` (the editor), and once more in `Reference`. The
 * copies had drifted, so a chip changed shape between typing it and sending it
 * (PEEK-ADOPTION 13.8). Measured in Peek's CSS on 2026-09-13 with the same
 * text: the reader's chips carried `mx-0.5`, 2px each side, where the editor's
 * had none; an `@mention` was 18px tall in the reader (an inline span) and 20px
 * in the editor (`text-sm`, an inline-flex box), against 19.6px for a topic.
 *
 * **Katerina's ruling (D67):** one chip for both, with the reader's 2px gap,
 * every chip 19.6px tall — the topic chip's shape.
 *
 * The shape is classes plus a style, not a component, because it is drawn by
 * three different things: a React element in the reader, a `NodeViewWrapper`
 * in the editor, and a ProseMirror `renderHTML` spec, which takes strings.
 */
export const INLINE_CHIP_CLASSES = 'inline-flex items-center gap-1 rounded-sm px-1 mx-0.5 text-body-2 font-normal select-none'

/** What a chip is made of, by what it points at. */
export const INLINE_CHIP_TONE_CLASSES = {
  /** A topic, a file, a message, another app's object. */
  neutral: 'bg-bg-active text-text-primary',
  /** A person. */
  mention: 'bg-accent-muted text-accent-primary',
  /** A person, urgently. */
  urgent: 'bg-warning-muted text-warning-default',
  /** A key nobody could resolve — still a mention, just an anonymous one. */
  quiet: 'bg-bg-active text-text-muted font-mono text-caption',
} as const

export type InlineChipTone = keyof typeof INLINE_CHIP_TONE_CLASSES

/** The chip's classes for a tone, with anything the caller adds. */
export function inlineChipClassName(tone: InlineChipTone, className?: string) {
  return cn(INLINE_CHIP_CLASSES, INLINE_CHIP_TONE_CLASSES[tone], className)
}

/**
 * One line high, sitting on the line of text like a word. `1.4em` is the body
 * text's line height, and the chip is aligned to the top of the line.
 *
 * **Top, not `text-bottom`** (Katerina, 2026-09-13, D67). Measured in Peek's
 * CSS at 14px, where a plain line is 19.59px: `text-bottom` — what the topic
 * chip had — made its line 21.19px and lifted the chip's words 1.59px above the
 * sentence's; `baseline` was right for a text-only chip but, with an icon
 * first, made the line 23.39px and the words 3.8px high. `top` keeps the line
 * at 19.59px and the words level, with or without an icon.
 */
export const INLINE_CHIP_STYLE: CSSProperties = { verticalAlign: 'top', height: '1.4em' }

/** The same style for a `renderHTML` spec, which takes a string. */
export const INLINE_CHIP_STYLE_ATTR = 'vertical-align: top; height: 1.4em'
