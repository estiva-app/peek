import { forwardRef, useEffect, useImperativeHandle, useState, useCallback, useRef } from 'react'
import { ReactRenderer, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import Mention from '@tiptap/extension-mention'
import { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
import { type NodeViewProps } from '@tiptap/react'
import { IconCircleDashed, IconCircleCheck, IconFile, IconFileTypePdf, IconPhoto, IconTable, IconPresentation } from '@tabler/icons-react'
import { mentionPeople, mentionTopics, type Person } from '@/api'
import { useIsTopicResolved } from '@/api'
import { MentionMenu } from '@/components/ui/MentionMenu'
import { FilesMenu, type FilesMenuItem, type FilesMenuRef } from '@/components/ui/FilesMenu'
import { hangSuggestion } from './suggestionPlacement'

// ─── Types ───

type MentionListRef = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface MentionListProps extends SuggestionProps {
  isUrgent: boolean
}

// ─── React wrapper around MentionMenu with keyboard navigation ───

const MentionListWrapper = forwardRef<MentionListRef, MentionListProps>(
  (props, ref) => {
    const [highlight, setHighlight] = useState(0)

    useEffect(() => setHighlight(0), [props.items])

    const selectItem = useCallback(
      (person: Person) => props.command(person),
      [props]
    )

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowDown') {
          setHighlight((h) => Math.min(h + 1, props.items.length - 1))
          return true
        }
        if (event.key === 'ArrowUp') {
          setHighlight((h) => Math.max(h - 1, 0))
          return true
        }
        if (event.key === 'Enter') {
          const person = props.items[highlight]
          if (person) selectItem(person)
          return true
        }
        return false
      },
    }))

    if (props.items.length === 0) return null

    return (
      <MentionMenu
        people={props.items}
        highlight={highlight}
        isUrgent={props.isUrgent}
        onSelect={selectItem}
        onHighlightChange={setHighlight}
      />
    )
  }
)
MentionListWrapper.displayName = 'MentionListWrapper'

/** The people and the files menus are the same width. */
const MENU_WIDTH = 658

// ─── Global flag: is a suggestion popup currently open? ───
// Counter instead of boolean - multiple suggestion plugins (mention, urgent, topic)
// can overlap during transitions, so we track how many are open.
let _openCount = 0
let _lastCloseTime = 0

export function isSuggestionActive(): boolean {
  return _openCount > 0 || (Date.now() - _lastCloseTime < 100)
}

/**
 * Open *now*, with no grace period — what Escape needs.
 *
 * `isSuggestionActive` counts the 100ms after a menu closes as still busy,
 * because picking a row with Enter closes the menu and that same Enter must
 * not also send the message. Escape wants the opposite: it closes the menu on
 * the first press and must cancel the edit on the second, so a grace period
 * would eat a press somebody made deliberately.
 */
export function isSuggestionOpen(): boolean {
  return _openCount > 0
}

/** Report a suggestion opening / closing from outside this file — the `/`
 *  menu lives in its own extension but shares this counter, so ComposeBox
 *  keeps one answer to "is a menu open?" rather than two. */
export function openSuggestion() {
  _openCount++
}

export function closeSuggestion() {
  _openCount = Math.max(0, _openCount - 1)
  _lastCloseTime = Date.now()
}

// ─── Suggestion popup controller ───

class SuggestionPopup {
  component: ReactRenderer<MentionListRef> | null = null
  container: HTMLDivElement | null = null

  onStart(props: SuggestionProps, isUrgent: boolean) {
    _openCount++
    this.component = new ReactRenderer(MentionListWrapper, {
      props: { ...props, isUrgent },
      editor: props.editor,
    })

    this.container = document.createElement('div')
    this.container.style.position = 'fixed'
    this.container.style.zIndex = '50'
    document.body.appendChild(this.container)
    this.container.appendChild(this.component.element)
    this.updatePosition(props)
  }

  onUpdate(props: SuggestionProps, isUrgent: boolean) {
    this.component?.updateProps({ ...props, isUrgent })
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
    _openCount = Math.max(0, _openCount - 1)
    _lastCloseTime = Date.now()
    this.component?.destroy()
    this.container?.remove()
    this.component = null
    this.container = null
  }

  private updatePosition(props: SuggestionProps) {
    if (!this.container || !props.clientRect) return
    const rect = (props.clientRect as () => DOMRect)()
    if (!rect) return
    hangSuggestion(this.container, rect, MENU_WIDTH)
  }
}

// ─── Suggestion config factory ───

function makeSuggestion(isUrgent: boolean): Omit<SuggestionOptions<Person>, 'editor'> {
  return {
    items: ({ query }) =>
      mentionPeople()
        .filter((p) => query === '' || p.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 6),

    render: () => {
      const popup = new SuggestionPopup()
      return {
        onStart: (props) => popup.onStart(props, isUrgent),
        onUpdate: (props) => popup.onUpdate(props, isUrgent),
        onKeyDown: (props) => popup.onKeyDown(props),
        onExit: () => popup.onExit(),
      }
    },

    command: ({ editor, range, props: person }) => {
      const nodeType = isUrgent ? 'urgentMention' : 'mention'
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: nodeType, attrs: { id: person.id, label: person.name, pubkey: person.pubkey ?? null } },
          { type: 'text', text: ' ' },
        ])
        .run()
    },
  }
}

// ─── Extensions ───

export const PeekMention = Mention.extend({
  name: 'mention',

  addAttributes() {
    return {
      id: { default: null },
      label: { default: null },
      /**
       * The mentioned person's Nostr key, when they have one — SPEC §13.1.
       *
       * `id` is Peek's own identifier and means nothing to another app; this is
       * what the body is serialised with, so a mention survives a rename and
       * resolves for a reader who does not hold this directory.
       */
      pubkey: { default: null },
    }
  },

  renderHTML({ node }) {
    return [
      'span',
      {
        'data-mention': 'true',
        'data-id': node.attrs.id,
        class:
          'inline-flex items-center rounded-sm px-1 bg-accent-muted text-accent-primary text-sm select-none cursor-default',
      },
      `@${node.attrs.label}`,
    ]
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }]
  },
}).configure({
  HTMLAttributes: {},
  suggestion: makeSuggestion(false),
})

export const UrgentMention = Mention.extend({
  name: 'urgentMention',

  addAttributes() {
    return {
      id: { default: null },
      label: { default: null },
      /**
       * The mentioned person's Nostr key, when they have one — SPEC §13.1.
       *
       * `id` is Peek's own identifier and means nothing to another app; this is
       * what the body is serialised with, so a mention survives a rename and
       * resolves for a reader who does not hold this directory.
       */
      pubkey: { default: null },
    }
  },

  renderHTML({ node }) {
    return [
      'span',
      {
        'data-urgent-mention': 'true',
        'data-id': node.attrs.id,
        class:
          'inline-flex items-center rounded-sm px-1 bg-warning-muted text-warning-default text-sm select-none cursor-default',
      },
      `@${node.attrs.label}`,
    ]
  },

  parseHTML() {
    return [{ tag: 'span[data-urgent-mention]' }]
  },
}).configure({
  HTMLAttributes: {},
  suggestion: {
    ...makeSuggestion(true),
    char: '!@',
  },
})

// ─── Files mention ([) ───

const FilesListWrapper = forwardRef<FilesMenuRef, SuggestionProps>(
  (props, ref) => {
    const menuRef = useRef<FilesMenuRef>(null)

    useImperativeHandle(ref, () => ({
      onKeyDown: (p: { event: KeyboardEvent }) => menuRef.current?.onKeyDown(p) ?? false,
    }))

    return (
      <FilesMenu
        ref={menuRef}
        items={props.items}
        query={props.query}
        onSelect={(item) => props.command(item)}
      />
    )
  }
)
FilesListWrapper.displayName = 'FilesListWrapper'

class FilesSuggestionPopup {
  component: ReactRenderer<FilesMenuRef> | null = null
  container: HTMLDivElement | null = null

  onStart(props: SuggestionProps) {
    _openCount++
    this.component = new ReactRenderer(FilesListWrapper, {
      props,
      editor: props.editor,
    })
    this.container = document.createElement('div')
    this.container.style.position = 'fixed'
    this.container.style.zIndex = '50'
    document.body.appendChild(this.container)
    this.container.appendChild(this.component.element)
    this.updatePosition(props)
  }

  onUpdate(props: SuggestionProps) {
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
    _openCount = Math.max(0, _openCount - 1)
    _lastCloseTime = Date.now()
    this.component?.destroy()
    this.container?.remove()
    this.component = null
    this.container = null
  }

  private updatePosition(props: SuggestionProps) {
    if (!this.container || !props.clientRect) return
    const rect = (props.clientRect as () => DOMRect)()
    if (!rect) return
    hangSuggestion(this.container, rect, MENU_WIDTH)
  }
}

function TopicMentionView({ node }: NodeViewProps) {
  const { id, label, isResolved } = node.attrs
  // Live runtime resolution overrides the snapshot stored in the node when it was
  // inserted, so an inline [Topic] tag's icon stays in sync with the topic's
  // current resolved state across the app.
  const isTopicResolved = useIsTopicResolved()
  const liveResolved = id ? isTopicResolved(String(id)) : isResolved
  return (
    <NodeViewWrapper as="span" className="inline-flex items-center gap-1 rounded-sm px-1 bg-bg-active text-text-primary text-body-2 font-normal select-none cursor-default" style={{ verticalAlign: 'text-bottom', height: '1.4em' }}>
      <span className="relative inline-flex items-center justify-center w-4 h-4 shrink-0">
        {liveResolved ? (
          <IconCircleCheck size={16} stroke={1.5} className="text-success-default" />
        ) : (
          <IconCircleDashed size={16} stroke={1.5} className="text-text-secondary" />
        )}
      </span>
      <span>{label}</span>
    </NodeViewWrapper>
  )
}

export const TopicMention = Mention.extend({
  name: 'topicMention',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      label: { default: null },
      isResolved: { default: false },
    }
  },

  renderHTML({ node }) {
    return [
      'span',
      {
        'data-topic-mention': 'true',
        'data-id': node.attrs.id,
        class:
          'inline-flex items-center gap-1 rounded-sm px-1 bg-bg-active text-text-primary text-sm select-none cursor-default',
      },
      `[${node.attrs.label}]`,
    ]
  },

  parseHTML() {
    return [{ tag: 'span[data-topic-mention]' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TopicMentionView, { as: 'span' })
  },
}).configure({
  HTMLAttributes: {},
  suggestion: {
    char: '[',
    items: (): FilesMenuItem[] => {
      // Topics only (Katerina, 2026-09-05). The Apps and Documents sections
      // were mock rows — a Figma category and a handful of invented files —
      // and they only ever appeared in mock mode, so the menu you reviewed
      // was not the menu the app shows. Placeholders retired, the way the
      // prototype reference chips were in #148.
      //
      // APP_FILES / DOCUMENT_FILES stay in `src/data`: MessageBody still
      // resolves them so reference chips in existing messages keep working.
      return mentionTopics().map((t) => ({ kind: 'topic', data: t }))
    },

    render: () => {
      const popup = new FilesSuggestionPopup()
      return {
        onStart: (props: SuggestionProps) => popup.onStart(props),
        onUpdate: (props: SuggestionProps) => popup.onUpdate(props),
        onKeyDown: (props: { event: KeyboardEvent }) => popup.onKeyDown(props),
        onExit: () => popup.onExit(),
      }
    },

    command: ({ editor, range, props: item }: any) => {
      // Topics are all `[` offers now, so this inserts a topicMention and
      // nothing else. The `fileMention` node it used to insert still exists
      // and MessageBody still renders it — messages already sent keep their
      // file references; there is simply no longer a way to add a new one.
      const topic = (item as FilesMenuItem).data
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          {
            type: 'topicMention',
            attrs: {
              id: topic.id,
              label: topic.title,
              isResolved: topic.isResolved,
            },
          },
          { type: 'text', text: ' ' },
        ])
        .run()
    },
  },
})

// ─── File mention (apps & documents) ───

import figmaIcon from '@/assets/figma icon.svg'

const FILE_SVG_ICONS: Record<string, string> = {
  figma: figmaIcon,
}

const FILE_TABLER_ICONS: Record<string, React.FC<{ size: number; stroke: number; className?: string }>> = {
  pdf: IconFileTypePdf,
  image: IconPhoto,
  spreadsheet: IconTable,
  presentation: IconPresentation,
  generic: IconFile,
}

function FileMentionView({ node }: NodeViewProps) {
  const { label, app } = node.attrs
  const svgSrc = FILE_SVG_ICONS[app]
  const TablerIcon = FILE_TABLER_ICONS[app] ?? IconFile
  return (
    <NodeViewWrapper as="span" className="inline-flex items-center gap-1 rounded-sm px-1 bg-bg-active text-text-primary text-body-2 font-normal select-none cursor-default" style={{ verticalAlign: 'text-bottom', height: '1.4em' }}>
      {svgSrc ? (
        <img src={svgSrc} width={14} height={14} alt={app} className="rounded-[2px] shrink-0" />
      ) : (
        <span className="flex items-center justify-center w-4 h-4 shrink-0 text-text-secondary">
          <TablerIcon size={14} stroke={1.5} />
        </span>
      )}
      <span>{label}</span>
    </NodeViewWrapper>
  )
}

export const FileMention = Mention.extend({
  name: 'fileMention',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      label: { default: null },
      app: { default: '' },
      subtitle: { default: '' },
    }
  },

  renderHTML({ node }) {
    return [
      'span',
      {
        'data-file-mention': 'true',
        'data-id': node.attrs.id,
        'data-app': node.attrs.app,
        class:
          'inline-flex items-center gap-1 rounded-sm px-1 bg-bg-active text-text-primary text-sm select-none cursor-default',
      },
      `[${node.attrs.label}]`,
    ]
  },

  parseHTML() {
    return [{ tag: 'span[data-file-mention]' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileMentionView, { as: 'span' })
  },
}).configure({
  HTMLAttributes: {},
  suggestion: {
    char: '\0',
    items: () => [],
  },
})
