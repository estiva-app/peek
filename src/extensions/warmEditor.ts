import { useEffect, useLayoutEffect, useState } from 'react'
import { Editor, type EditorOptions } from '@tiptap/core'

/*
  A composer's editor, built ahead (4ef41d41).

  Building a Tiptap editor — its extensions, schema, commands and view — is
  the longest single step in drawing a composer: about 20 ms of a new topic's
  100 ms from Start to the place to type. One is built while the page is
  idle, and the next composer to mount takes it and builds the next.

  `useWarmEditor` stands in for `@tiptap/react`'s `useEditor` with no deps,
  and keeps what it does: the latest options' callbacks are the ones called,
  options are applied again on each render, and the editor is destroyed when
  its component goes. A spare is taken only for the same extensions and an
  empty document; anything else is built on the spot, as before.
*/

type Options = Partial<EditorOptions>

/** The callbacks an editor binds once, when it is built: they reach whatever component holds it now. */
const BOUND = [
  'onBeforeCreate',
  'onMount',
  'onUnmount',
  'onContentError',
  'onCreate',
  'onUpdate',
  'onSelectionUpdate',
  'onTransaction',
  'onFocus',
  'onBlur',
  'onDestroy',
  'onDelete',
] as const

/** Callbacks `useEditor` leaves out when it decides whether options changed. */
const CALLBACKS = new Set<string>([...BOUND, 'onDrop', 'onPaste'])

/** An editor and the options its bound callbacks read; `destroyAt` destroys it unless a mounted component holds it. */
interface Held {
  editor: Editor
  options: { current: Options }
  destroyAt?: ReturnType<typeof setTimeout>
}

function build(options: Options): Held {
  const held: Held = { options: { current: options } } as Held
  const relay = Object.fromEntries(
    BOUND.map((name) => [name, (...args: unknown[]) => (held.options.current[name] as ((...a: unknown[]) => void) | undefined)?.(...args)]),
  )
  held.editor = new Editor({ ...options, ...relay })
  return held
}

let warmFor: Options['extensions'] | null = null
let spare: Held | null = null
let scheduled = false

/** Build the next spare when the page is idle. Without `requestIdleCallback` there is none, and every composer builds its own. */
function scheduleSpare() {
  if (!warmFor || spare || scheduled || typeof window === 'undefined' || !window.requestIdleCallback) return
  scheduled = true
  window.requestIdleCallback(() => {
    scheduled = false
    if (!warmFor || spare) return
    // No autofocus: it would fire on the detached spare. The composer that takes it focuses it.
    spare = build({ extensions: warmFor, autofocus: false })
  })
}

/** Keep a spare editor with these extensions — the ones `ComposeBox` builds every composer with. */
export function keepWarmEditor(extensions: NonNullable<Options['extensions']>): void {
  warmFor = extensions
  scheduleSpare()
}

function take(options: Options): Held | null {
  const held = spare
  if (!held || held.editor.isDestroyed || options.extensions !== warmFor || (options.content ?? '') !== '') return null
  spare = null
  held.options.current = options
  // Its view exists already: the composer's props (classes, keys, paste) go on before it is drawn.
  held.editor.setOptions(withoutBound(options))
  return held
}

function withoutBound(options: Options): Options {
  return Object.fromEntries(Object.entries(options).filter(([key]) => !(BOUND as readonly string[]).includes(key)))
}

/** `useEditor`'s rule: the same options, callbacks aside, and the same extensions in the same order. */
function sameOptions(a: Options, b: Options): boolean {
  return Object.keys(a).every((key) => {
    if (CALLBACKS.has(key)) return true
    if (key === 'extensions' && a.extensions && b.extensions)
      return a.extensions.length === b.extensions.length && a.extensions.every((extension, i) => extension === b.extensions?.[i])
    return a[key as keyof Options] === b[key as keyof Options]
  })
}

export function useWarmEditor(options: Options): Editor {
  const [{ held, warm }] = useState(() => {
    const taken = take(options)
    const held = taken ?? build(options)
    // A render thrown away never mounts: what it built goes with it. Later than
    // React lets a transition run before it finishes it at once (5 s), so a
    // slow render that does commit never mounts a destroyed editor.
    held.destroyAt = setTimeout(() => held.editor.destroy(), 10_000)
    scheduleSpare()
    return { held, warm: !!taken }
  })
  const { editor } = held

  useLayoutEffect(() => {
    held.options.current = options
  })

  // Mounted, it is this component's until it unmounts — and not remounted at once, as in StrictMode.
  useLayoutEffect(() => {
    clearTimeout(held.destroyAt)
    return () => {
      held.destroyAt = setTimeout(() => editor.destroy(), 1)
    }
  }, [held, editor])

  useEffect(() => {
    if (editor.isDestroyed || sameOptions(options, editor.options)) return
    editor.setOptions({ ...withoutBound(options), editable: editor.isEditable })
  })

  // A spare was built without autofocus; Tiptap focuses a new editor once it is drawn, so this does the same.
  const autofocus = warm ? options.autofocus : false
  useEffect(() => {
    if (autofocus === false || autofocus === null || autofocus === undefined) return
    const timer = setTimeout(() => !editor.isDestroyed && editor.commands.focus(autofocus), 0)
    return () => clearTimeout(timer)
    // Once per editor: Tiptap reads `autofocus` when it builds one, never again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  return editor
}
