/**
 * CONCEPT — marking as you write (trial, Miky 19 Nov). Copied unchanged into Peek's and Leaf's concept folders, as
 * MarkAs.tsx is; the build puts both into the shared composer and block editor in @estiva-app/ui.
 * - A symbol alone on a line, then Enter: the line goes and the message (in a message box, its first line only) or
 *   the block (in a document) is marked with that word.
 * - Ctrl/⌘ + . opens Mark as at the caret; typing a symbol there picks its word (!, then ! again within a moment, for
 *   Blocker). The key itself waits for the shortcut strategy (Miky, 19 Nov: "at some point we need a more holistic
 *   strategy about shortcuts"): it is a placeholder.
 * The concept listens on the box's own element, before the editor does; the build makes both editor commands.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { SuggestionMenu, type SuggestionMenuHandle } from '@estiva-app/ui'
import { SYMBOL, WORDS, wordIcon, wordTone, type MarkWord } from './MarkAs'

const BY_SYMBOL: Record<string, MarkWord> = Object.fromEntries(Object.entries(SYMBOL).map(([w, s]) => [s, w as MarkWord]))

/** The text block the caret is in, inside `root`. */
function blockAtCaret(root: HTMLElement, selector: string): HTMLElement | null {
  const n = window.getSelection()?.anchorNode
  if (!n || !root.contains(n)) return null
  const el = (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement)?.closest(selector) as HTMLElement | null
  return el && root.contains(el) ? el : null
}

/**
 * Typed marks inside `root`: `block` is the CSS selector of one text block (a paragraph of the message, a document's
 * block); `firstOnly`, a message box's rule that only its first line counts. Returns the picker to render.
 */
export function useTypedMark(
  root: RefObject<HTMLElement | null>,
  {
    block,
    firstOnly = false,
    onMark,
    onUnmark,
  }: {
    block: string
    firstOnly?: boolean
    onMark: (word: MarkWord, el: HTMLElement) => void
    /** Backspace with the caret at a marked block's start takes the mark off (Miky, 19 Nov); returns false when it had none. */
    onUnmark?: (el: HTMLElement) => boolean
  },
): ReactNode {
  const [picker, setPicker] = useState<{ rect: DOMRect; el: HTMLElement }>()
  const handle = useRef<SuggestionMenuHandle>(null)
  const typed = useRef('')
  const wait = useRef<ReturnType<typeof setTimeout>>(undefined)
  const mark = useRef(onMark)
  mark.current = onMark
  const unmark = useRef(onUnmark)
  unmark.current = onUnmark

  useEffect(() => {
    const r = root.current
    if (!r) return
    const key = (e: KeyboardEvent) => {
      const el = blockAtCaret(r, block)
      if (!el) return
      if (e.key === 'Backspace' && unmark.current) {
        // The caret at the block's very start, nothing selected: the first Backspace takes the mark off, the next one edits.
        const sel = window.getSelection()
        if (!sel?.rangeCount || !sel.isCollapsed) return
        const before = document.createRange()
        before.selectNodeContents(el)
        before.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset)
        if (before.toString() !== '' || (firstOnly && el.parentElement?.firstElementChild !== el)) return
        if (unmark.current(el)) (e.preventDefault(), e.stopPropagation())
        return
      }
      // Enter, Ctrl/⌘ + Enter alike (Miky, 19 Nov); Shift + Enter stays a new line.
      if (e.key === 'Enter' && !e.shiftKey) {
        const word = BY_SYMBOL[el.textContent?.trim() ?? '']
        if (!word || (firstOnly && el.parentElement?.firstElementChild !== el)) return
        e.preventDefault()
        e.stopPropagation()
        const range = document.createRange()
        range.selectNodeContents(el)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
        document.execCommand('delete')
        mark.current(word, el)
      } else if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault()
        e.stopPropagation()
        const sel = window.getSelection()
        const rect = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : el.getBoundingClientRect()
        typed.current = ''
        setPicker({ rect: rect.height ? rect : el.getBoundingClientRect(), el })
      }
    }
    r.addEventListener('keydown', key, true)
    return () => r.removeEventListener('keydown', key, true)
  }, [root, block, firstOnly])

  // While the picker is open, the keys are its own: a symbol picks, arrows and Enter move and choose, Escape closes.
  useEffect(() => {
    if (!picker) return
    const pick = (word: MarkWord) => (clearTimeout(wait.current), setPicker(undefined), mark.current(word, picker.el))
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return e.preventDefault(), setPicker(undefined)
      if (handle.current?.onKeyDown(e)) return e.preventDefault()
      if (e.key.length !== 1) return
      e.preventDefault()
      e.stopPropagation()
      clearTimeout(wait.current)
      typed.current += e.key
      const t = typed.current
      const longer = Object.values(SYMBOL).some((s) => s !== t && s.startsWith(t))
      if (BY_SYMBOL[t] && !longer) return pick(BY_SYMBOL[t])
      if (BY_SYMBOL[t]) wait.current = setTimeout(() => pick(BY_SYMBOL[t]), 450)
      else if (!longer) typed.current = ''
    }
    // @estiva-escape(no-rebuilt-behaviour): concept only: the typed symbol reaches the picker while focus stays in the text; the build makes it an editor suggestion command, as @ and / are
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [picker])

  if (!picker) return null
  // The symbol at the row's right edge, as every Mark as menu has it (Miky, 19 Nov); the kit's picker rows take an
  // `aside` beside the label only, so the concept pushes it right; the build gives SuggestionMenu's row a `trailing`.
  return (
    <>
    <style>{`[aria-label="Mark as"] .items-baseline>span:last-child{margin-left:auto}`}</style>
    <SuggestionMenu<MarkWord>
      rect={picker.rect}
      editorElement={root.current}
      ariaLabel="Mark as"
      width="w-56"
      maxHeight="max-h-96"
      sections={[{ items: ['Highlight'] }, { items: WORDS }]}
      itemKey={(w) => w}
      row={(w) => ({ label: w, aside: SYMBOL[w], leading: <span style={wordTone(w)}>{wordIcon(w)}</span> })}
      onSelect={(w) => (setPicker(undefined), mark.current(w, picker.el))}
      handle={handle}
    />
    </>
  )
}
