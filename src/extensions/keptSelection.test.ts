// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { DecorationSet } from '@tiptap/pm/view'
import { peekStarterKit } from './editorKit'
import { keepSelection, releaseSelection, keptSelection, keptSelectionKey } from './keptSelection'

/**
 * The kept selection — PEE-19. Runs against the real editor kit, which
 * registers the extension for every Peek editor.
 */

let editor: Editor

beforeEach(() => {
  editor = new Editor({ extensions: [peekStarterKit], content: '<p>read the widgets topic first</p>' })
  editor.commands.setTextSelection({ from: 10, to: 23 })
})

afterEach(() => {
  editor.destroy()
})

/** The ranges the plugin is drawing right now. */
function drawn(): Array<[number, number]> {
  const plugin = keptSelectionKey.get(editor.state)
  if (!plugin || typeof plugin.props.decorations !== 'function') return []
  const set = plugin.props.decorations.call(plugin, editor.state)
  if (!(set instanceof DecorationSet)) return []
  return set.find().map((d) => [d.from, d.to])
}

describe('keeping the selection', () => {
  it('draws nothing until asked', () => {
    expect(keptSelection(editor)).toBeNull()
    expect(drawn()).toEqual([])
  })

  it('draws the selection as it is when kept, and stops when released', () => {
    keepSelection(editor)
    expect(keptSelection(editor)).toEqual({ from: 10, to: 23 })
    expect(drawn()).toEqual([[10, 23]])
    releaseSelection(editor)
    expect(keptSelection(editor)).toBeNull()
    expect(drawn()).toEqual([])
  })

  it('follows the words through an edit before them', () => {
    keepSelection(editor)
    editor.commands.insertContentAt(1, 'X')
    expect(keptSelection(editor)).toEqual({ from: 11, to: 24 })
    expect(editor.state.doc.textBetween(11, 24)).toBe('widgets topic')
  })

  it('releasing with nothing kept dispatches nothing', () => {
    const before = editor.state
    releaseSelection(editor)
    expect(editor.state).toBe(before)
  })

  it('an empty selection is kept but not drawn', () => {
    editor.commands.setTextSelection(15)
    keepSelection(editor)
    expect(keptSelection(editor)).toEqual({ from: 15, to: 15 })
    expect(drawn()).toEqual([])
  })
})
