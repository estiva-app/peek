import { NodeViewWrapper, ReactNodeViewRenderer, nodePasteRule } from '@tiptap/react'
import Mention from '@tiptap/extension-mention'
import { type SuggestionOptions } from '@tiptap/suggestion'
import { suggestionPopup } from '@estiva-app/ui/editor'
import { type NodeViewProps } from '@tiptap/react'
import { IconCircleDashed, IconCircleCheck, IconFile, IconFileTypePdf, IconMessage, IconPhoto, IconTable, IconPresentation } from '@tabler/icons-react'
import { encodeNevent } from '@estiva-app/protocol'
import { mentionPeople, useResolvedReferences, type Person } from '@/api'
import { mentionMessages } from '@/api/mentions'
import { isObjectAddress, previewText } from '@/lib/textParsing'
import { MESSAGE_KIND } from '@/nostr/manifest'
import { peopleMenu } from '@/components/ui/MentionMenu'
import { inlineChipClassName } from '@estiva-app/ui'
import { FILES_MENU, type FilesMenuItem } from '@/components/ui/FilesMenu'
import type { ForeignObject } from '@estiva-app/interop'
import { Reference } from '@/components/ui/Reference'

// ─── Suggestion config factory ───
//
// The list — its box, keys, highlight and the "is a menu open?" counter the
// editors ask — is the package's since UIG-31 (estiva-ui 0.45.0):
// `suggestionPopup` draws `peopleMenu`'s rows as a `SuggestionMenu`.

function makeSuggestion(isUrgent: boolean): Omit<SuggestionOptions<Person>, 'editor'> {
  return {
    items: ({ query }) =>
      mentionPeople()
        .filter((p) => query === '' || p.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 6),

    render: suggestionPopup(peopleMenu(isUrgent)),

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
        // No node view, so this spec is what the editor draws: the one chip (D67).
        class: inlineChipClassName('person', 'cursor-default'),
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
        // No node view, so this spec is what the editor draws: the one chip (D67).
        class: inlineChipClassName('urgent', 'cursor-default'),
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

/*
  Nothing inserts a `topicMention` since FOL-23 took topics out of the `[` menu,
  and nothing parses one out of a body. The node stays because the `[`
  suggestion plugin is configured on it, and a chip already in an open editor
  still has to draw and serialise; it draws from the snapshot it was made with.
*/
function TopicMentionView({ node }: NodeViewProps) {
  const { label, isResolved } = node.attrs
  return (
    <NodeViewWrapper as="span" className={inlineChipClassName('neutral', 'cursor-default')}>
      <span className="relative inline-flex items-center justify-center w-4 h-4 shrink-0">
        {isResolved ? (
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
      /**
       * The topic's address — `39000:<relay-pubkey>:<channel-uuid>` — when
       * Peek can spell it (RIC-11). `id` is a Convex key and `label` is a
       * title that goes stale; this is what the body is serialised with, so
       * the mention resolves in an app that holds neither and survives a
       * rename. Null for a topic with no channel, which serialises as the
       * bracket form it always did.
       */
      address: { default: null },
    }
  },

  renderHTML({ node }) {
    return [
      'span',
      {
        'data-topic-mention': 'true',
        'data-id': node.attrs.id,
        class: inlineChipClassName('neutral', 'cursor-default'),
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
      // The messages on screen (RIC-11). Topics went with Convex (FOL-23).
      // The Apps and Documents sections that used to sit here were mock rows
      // — a Figma category and a handful of invented files — and they only
      // ever appeared in mock mode, so the menu you reviewed was not the menu
      // the app shows. Placeholders retired (Katerina, 2026-09-05), the way
      // the prototype reference chips were in #148.
      //
      // APP_FILES / DOCUMENT_FILES stay in `src/data`: MessageBody still
      // resolves them so reference chips in existing messages keep working.
      return mentionMessages().map((m): FilesMenuItem => ({ kind: 'message', data: m }))
    },

    render: suggestionPopup(FILES_MENU),

    command: ({ editor, range, props: item }: any) => {
      // A message (RIC-11). The `fileMention` node this used to insert still
      // exists and MessageBody still renders it — messages already sent keep
      // their file references; there is simply no longer a way to add a new
      // one.
      const picked = item as FilesMenuItem
      const node = {
        type: 'messageMention',
        attrs: {
          id: picked.data.eventId,
          label: picked.data.author,
          snippet: previewText(picked.data.body),
          /*
            The kind travels in the pointer so a reader can fetch the manifest
            and the event together rather than one after the other
            (`resolveForeignEvent`). No relay hint: the same omission every
            `naddr` Peek writes makes, and for the same reason — a reader on
            this relay needs none, and one elsewhere cannot read the event
            anyway.
          */
          uri: `nostr:${encodeNevent({ id: picked.data.eventId as string, relays: [], kind: MESSAGE_KIND })}`,
        },
      }
      editor
        .chain()
        .focus()
        .insertContentAt(range, [node, { type: 'text', text: ' ' }])
        .run()
    },
  },
})

// ─── Message mention (RIC-11) ───

function MessageMentionView({ node }: NodeViewProps) {
  const { label, snippet } = node.attrs
  return (
    <NodeViewWrapper as="span" className={inlineChipClassName('neutral', 'cursor-default')} style={{ maxWidth: '24ch' }}>
      <span className="flex items-center justify-center w-4 h-4 shrink-0 text-text-secondary">
        <IconMessage size={14} stroke={1.5} />
      </span>
      <span className="truncate">{snippet ? `${label}: ${snippet}` : label}</span>
    </NodeViewWrapper>
  )
}

/**
 * A message, mentioned mid-sentence — SPEC §13.1's reference, pointed at an
 * event rather than an address (RIC-11).
 *
 * Its own node rather than a `topicMention` with a different icon because the
 * two serialise differently: a topic has an address and a bracket fallback, a
 * message has an event id and nothing older to fall back to — there was never
 * a way to write one before this, so `uri` is never null.
 */
export const MessageMention = Mention.extend({
  name: 'messageMention',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      /** The event id. */
      id: { default: null },
      /** The author, as the thread showed them. */
      label: { default: null },
      /** The opening words, marks stripped — a caption, never parsed. */
      snippet: { default: '' },
      /** `nostr:nevent…`, exactly as the body carries it. */
      uri: { default: null },
    }
  },

  renderHTML({ node }) {
    return [
      'span',
      {
        'data-message-mention': 'true',
        'data-id': node.attrs.id,
        class: inlineChipClassName('neutral', 'cursor-default'),
      },
      node.attrs.snippet ? `${node.attrs.label}: ${node.attrs.snippet}` : node.attrs.label,
    ]
  },

  parseHTML() {
    return [{ tag: 'span[data-message-mention]' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MessageMentionView, { as: 'span' })
  },
}).configure({
  HTMLAttributes: {},
  // Inserted by the `[` menu above; it opens no menu of its own.
  suggestion: {
    char: '\0',
    items: () => [],
  },
})

// ─── File mention (apps & documents) ───

const FILE_TABLER_ICONS: Record<string, React.FC<{ size: number; stroke: number; className?: string }>> = {
  pdf: IconFileTypePdf,
  image: IconPhoto,
  spreadsheet: IconTable,
  presentation: IconPresentation,
  generic: IconFile,
}

function FileMentionView({ node }: NodeViewProps) {
  const { label, app } = node.attrs
  const TablerIcon = FILE_TABLER_ICONS[app] ?? IconFile
  return (
    <NodeViewWrapper as="span" className={inlineChipClassName('neutral', 'cursor-default')}>
      <span className="flex items-center justify-center w-4 h-4 shrink-0 text-text-secondary">
        <TablerIcon size={14} stroke={1.5} />
      </span>
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
        class: inlineChipClassName('neutral', 'cursor-default'),
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

// ─── Another app's object (UIG-40) ───

/** What a story or a test hands the composer instead of asking the relay: `ComposeBox`'s `resolvedObjects`. */
type ObjectMentionStorage = { supplied?: Record<string, ForeignObject> }

function ObjectMentionView({ node, editor }: NodeViewProps) {
  const uri: string = node.attrs.uri
  const storage = (editor.storage as unknown as { objectMention?: ObjectMentionStorage }).objectMention
  const supplied = storage?.supplied?.[uri] ?? storage?.supplied?.[uri.replace(/^nostr:/, '')]
  // Asked for only when nothing was handed in; the hook is called either way.
  const fetched = useResolvedReferences(supplied ? [] : [uri])
  return (
    <NodeViewWrapper as="span">
      <Reference uri={uri} object={supplied ?? fetched[uri]} link={false} />
    </NodeViewWrapper>
  )
}

/**
 * Another app's object in the composer — an issue the launcher just created, a
 * pasted address, one in a draft or an edit coming back (UIG-40, Katerina 28
 * September).
 *
 * **It is the sent message's chip.** `Reference`, the same title and status in
 * its colour, so what is written looks like what is sent — with `link={false}`,
 * because a click while writing is not a way out of the draft, and the editor
 * draws every link blue and underlined, which the sent chip never is. It looks
 * the object up itself, as `MessageBody` does for a body: the composer holds
 * only the address.
 *
 * **It sends the address, verbatim.** `serializeInline` writes `attrs.uri` back,
 * so the message on the wire is exactly what it was when this was text.
 *
 * A pasted address becomes one too, unless it is an old topic's, which stays
 * the text it is (a topic chip comes from the `[` menu or a draft).
 */
export const ObjectMention = Mention.extend({
  name: 'objectMention',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      /** `nostr:naddr…`, exactly as the body carries it. */
      uri: { default: null },
    }
  },

  addStorage() {
    return { supplied: undefined } as ObjectMentionStorage
  },

  renderHTML({ node }) {
    return ['span', { 'data-object-mention': 'true', class: inlineChipClassName('neutral', 'cursor-default') }, node.attrs.uri]
  },

  parseHTML() {
    return [{ tag: 'span[data-object-mention]' }]
  },

  addPasteRules() {
    return [
      nodePasteRule({
        find: /nostr:naddr1[023456789acdefghjklmnpqrstuvwxyz]+/g,
        type: this.type,
        getAttributes: (match) => (isObjectAddress(match[0]) ? { uri: match[0] } : null),
      }),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ObjectMentionView, { as: 'span' })
  },
}).configure({
  HTMLAttributes: {},
  // Inserted by the launcher, a paste or a draft; it opens no menu of its own.
  suggestion: {
    char: '\0',
    items: () => [],
  },
})
