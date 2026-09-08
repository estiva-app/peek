import { Extension, type Editor } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { forwardRef, useImperativeHandle, useRef } from 'react'
import { SlashMenu, filterSlashItems, type SlashItem, type SlashMenuRef } from '@/components/ui/SlashMenu'
import { applyFormat } from '@/lib/composerFormats'
import { insertHighlightTag } from './highlight'
import { openSuggestion, closeSuggestion } from './mention'
import { hangSuggestion } from './suggestionPlacement'

/** `SlashMenu`'s own `w-[300px]`. */
const MENU_WIDTH = 300

/**
 * `/` as a suggestion — PEE-18.
 *
 * **Why this replaced a bespoke implementation.** The old `/` menu watched the
 * whole document and only opened when the composer's text *began* with `/`
 * (`fullText.startsWith('/') && doc.childCount === 1`), so it was unreachable
 * mid-sentence and on any line but the first — the thing Katerina hit
 * immediately. `@`, `!@` and `[` never had that problem because they were
 * always suggestion plugins, which match at the caret. This makes `/` the same
 * kind of thing as its three neighbours rather than a special case beside them.
 *
 * `allowedPrefixes` is the plugin's default (`[' ']`), so a `/` inside a word —
 * `and/or`, a path, a URL — does not open anything. `startOfLine` is false,
 * which is the whole point.
 *
 * The popup mirrors `mention.tsx`'s: a fixed container on the body holding a
 * `ReactRenderer`, placed by the shared `hangSuggestion`. It reports into the
 * same open-counter, so the Enter handler in each of the three editors already
 * knows not to send or save while it is open.
 *
 * Three editors, not one: this shipped registered only in `ComposeBox`, so `/`
 * did nothing when you edited a sent message. It is in `peekEditor.ts` now,
 * with the six extensions it always belonged beside.
 */

const SlashListWrapper = forwardRef<SlashMenuRef, SuggestionProps<SlashItem>>((props, ref) => {
  const menuRef = useRef<SlashMenuRef>(null)
  useImperativeHandle(ref, () => ({
    onKeyDown: (p) => menuRef.current?.onKeyDown(p) ?? false,
  }))
  return <SlashMenu ref={menuRef} items={props.items} onSelect={(item) => props.command(item)} />
})
SlashListWrapper.displayName = 'SlashListWrapper'

class SlashSuggestionPopup {
  component: ReactRenderer<SlashMenuRef> | null = null
  container: HTMLDivElement | null = null

  onStart(props: SuggestionProps<SlashItem>) {
    openSuggestion()
    this.component = new ReactRenderer(SlashListWrapper, { props, editor: props.editor })
    this.container = document.createElement('div')
    this.container.style.position = 'fixed'
    this.container.style.zIndex = '50'
    document.body.appendChild(this.container)
    this.container.appendChild(this.component.element)
    this.updatePosition(props)
  }

  onUpdate(props: SuggestionProps<SlashItem>) {
    this.component?.updateProps(props)
    this.updatePosition(props)
  }

  onKeyDown(props: { event: KeyboardEvent }) {
    if (props.event.key === 'Escape') {
      this.onExit()
      return true
    }
    return this.component?.ref?.onKeyDown(props) ?? false
  }

  onExit() {
    closeSuggestion()
    this.component?.destroy()
    this.container?.remove()
    this.component = null
    this.container = null
  }

  private updatePosition(props: SuggestionProps<SlashItem>) {
    if (!this.container || !props.clientRect) return
    const rect = (props.clientRect as () => DOMRect | null)()
    if (!rect) return
    hangSuggestion(this.container, rect, MENU_WIDTH)
  }
}

/** Run the chosen row, having first removed the `/query` that summoned it. */
export function runSlashItem(editor: Editor, range: { from: number; to: number }, item: SlashItem) {
  editor.chain().focus().deleteRange(range).run()
  if (item.kind === 'format') {
    applyFormat(editor, item.id)
  } else if (item.kind === 'highlight') {
    insertHighlightTag(editor, item.type)
  } else {
    // Type the trigger so its own suggestion plugin picks it up. Deferred a
    // frame: the delete above has to land first, or the plugin sees the
    // character arrive inside a range that is still being removed.
    requestAnimationFrame(() => editor.commands.insertContent(item.input))
  }
}

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => runSlashItem(editor, range, props),
        render: () => {
          const popup = new SlashSuggestionPopup()
          return {
            onStart: (props) => popup.onStart(props),
            onUpdate: (props) => popup.onUpdate(props),
            onKeyDown: (props) => popup.onKeyDown(props),
            onExit: () => popup.onExit(),
          }
        },
      }),
    ]
  },
})
