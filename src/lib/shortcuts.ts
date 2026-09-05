/**
 * How Peek names a keyboard shortcut.
 *
 * One place, because the app shows shortcuts in three: the top bar's search
 * field, the command launcher's footer, and the selection toolbar's tooltips.
 * They disagreed before this file existed — two of them hardcoded `⌘` and
 * showed a Mac glyph to somebody on Windows.
 *
 * **Words, not glyphs** (Katerina, 2026-09-05). Besides being wrong on the
 * other platform, `⌘` is not in Geist Mono, so it fell back to a system face
 * and sat oddly beside the letter next to it — `K` advances 6px in the chip's
 * own font, `⌘` 10.97px in the fallback.
 *
 * The shared `Kbd` renders what it is handed and formats nothing, by design:
 * only the app knows which platform it is looking at.
 */

/** Whether this machine calls the modifier Cmd rather than Ctrl. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')
}

/**
 * `Mod-B` → `Cmd+B` on a Mac, `Ctrl+B` elsewhere.
 *
 * Takes Tiptap's own spelling (`Mod-Shift-B`) so a binding can be passed
 * straight through from wherever it was read.
 */
export function shortcutLabel(keys: string, apple = isApplePlatform()): string {
  return keys
    .split('-')
    .map((part, i, all) => {
      if (i === all.length - 1) return part.length === 1 ? part.toUpperCase() : part
      if (part === 'Mod') return apple ? 'Cmd' : 'Ctrl'
      return part
    })
    .join('+')
}
