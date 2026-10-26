import { NodeViewWrapper, ReactNodeViewRenderer, nodePasteRule } from '@tiptap/react'
import Mention from '@tiptap/extension-mention'
import { CaptionedReference, PersonMention, ReferenceNode, ReferenceTrigger, UrgentPersonMention, urgentPubkeys } from '@estiva-app/ui/editor'
import { type NodeViewProps } from '@tiptap/react'
import { IconCircleDashed, IconCircleCheck, IconFile, IconFileTypePdf, IconMessage, IconPhoto, IconTable, IconPresentation } from '@tabler/icons-react'
import { referenceSections, subscribeReferences, useResolvedReferences } from '@/api'
import { mentionMessages } from '@/api/mentions'
import { isObjectAddress } from '@/lib/textParsing'
import { referenceGlyphOfUri } from '@/lib/fileGlyph'
import { mentionDirectory } from '@/components/ui/MentionMenu'
import { InlineChip, KindIcon, LinkRow, inlineChipClassName } from '@estiva-app/ui'
import { FILES_MENU_COPY, FILES_MENU_ICON, toReferenceItem } from '@/components/ui/FilesMenu'
import type { ForeignObject } from '@estiva-app/interop'
import { Reference } from '@/components/ui/Reference'
import { linkStateOf } from '@/lib/linked'
import { isRowOfDecorations } from './loneLinkRows'

/**
 * A line that is only this link, drawn as its row while it is written, as the
 * sent message will draw it (`loneLinkRows`). A click on it while writing is
 * not a way out of the draft, as a chip's is not.
 */
export function RowInTheBox({ uri, object }: { uri: string; object: ForeignObject | null | undefined }) {
  return (
    <span
      data-box-row
      className="block cursor-default"
      onClickCapture={(event) => {
        if ((event.target as Element).closest('a')) event.preventDefault()
      }}
    >
      <LinkRow link={linkStateOf(uri, object)} preview={false} />
    </span>
  )
}

// ─── @ and !@ ───
//
// The triggers, their lists and their chips are the package's since CON-27
// (estiva-ui 0.52.0); what Peek adds is who can be mentioned. What a chip
// writes is `@estiva-app/conversation`'s `mentionText` (`serializeInline`).

export const PeekMention = PersonMention.configure({ people: mentionDirectory })

/** `!@`. Its text is an ordinary mention; the urgency is a tag (CON-17), from {@link extractUrgent}. */
export const UrgentMention = UrgentPersonMention.configure({ people: mentionDirectory })


/**
 * The pubkeys the document's urgent mentions name (CON-17) — what the write
 * turns into `["urgent", <pubkey>]`. A chip with no key is still `!@Name` in
 * the text.
 */
export const extractUrgent = urgentPubkeys

// ─── [ ───

/*
  Nothing inserts a `topicMention` since FOL-23 took topics out of the `[` menu,
  and nothing parses one out of a body. A chip already in an open editor still
  has to draw and serialise, so the node stays; it draws from the snapshot it
  was made with. The `[` list was configured on it until CON-27, and is
  `PeekReferenceTrigger` below.
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
  // It opens no list of its own any more; `[` is PeekReferenceTrigger's.
  suggestion: {
    char: '\0',
    items: () => [],
  },
})

// ─── Message mention (RIC-11) ───

/**
 * A message, mentioned mid-sentence — SPEC §13.1's reference, pointed at an
 * event rather than an address (RIC-11). The package's `CaptionedReference`
 * under the name Peek's bodies, drafts and parser have always used, so its
 * HTML stays `span[data-message-mention]`.
 *
 * Its own node rather than a `topicMention` with a different icon because the
 * two serialise differently: a topic has an address and a bracket fallback, a
 * message has an event id and nothing older to fall back to — there was never
 * a way to write one before this, so `uri` is never null.
 */
/** What it points at, as its row in the list showed it: a topic, a Ship project or issue, a file, a message (7 October). */
function messageMentionIcon(uri: string | null) {
  const glyph = referenceGlyphOfUri(uri)
  return glyph ? <KindIcon kind={glyph} size={14} tone="inherit" /> : <IconMessage size={14} stroke={1.5} />
}

/*
  The package's chip, drawn with its own `InlineChip` instead of its node view,
  so a line that is only this link can draw its row instead (`loneLinkRows`):
  the package's view takes nothing beside the caption. The same icon, the same
  `label: snippet` caption and the same 24ch cap as `CaptionedReference`'s view.
*/
function MessageMentionView({ node, decorations }: NodeViewProps) {
  const uri: string = node.attrs.uri ?? ''
  const row = isRowOfDecorations(decorations)
  // Asked for only while it draws its row; a chip has its caption.
  const fetched = useResolvedReferences(row && uri ? [uri] : [])
  if (row) {
    return (
      <NodeViewWrapper as="span">
        <RowInTheBox uri={uri} object={fetched[uri]} />
      </NodeViewWrapper>
    )
  }
  const label = String(node.attrs.label ?? '')
  const snippet = String(node.attrs.snippet ?? '')
  return (
    <NodeViewWrapper as="span" className="cursor-default">
      <InlineChip icon={messageMentionIcon(node.attrs.uri ?? null)} className="max-w-[24ch]">
        <span className="truncate">{snippet ? `${label}: ${snippet}` : label}</span>
      </InlineChip>
    </NodeViewWrapper>
  )
}

export const MessageMention = CaptionedReference.extend({
  name: 'messageMention',
  addNodeView() {
    return ReactNodeViewRenderer(MessageMentionView, { as: 'span' })
  },
}).configure({
  icon: <IconMessage size={14} stroke={1.5} />,
  iconFor: messageMentionIcon,
})

/** Each `[` row with the icon of what it is — the chip it inserts wears the same, from its URI (7 October). */
export function referenceRowIcon(uri: string) {
  const glyph = referenceGlyphOfUri(uri)
  return glyph ? <KindIcon kind={glyph} /> : undefined
}

/**
 * `[` — Messages, then Files (PEE-21), inserted as a {@link MessageMention}
 * carrying the `nevent` or `naddr` the body is written with. The sections and
 * their order are `referenceSections`'s; `items` is what a list without them
 * would show. The Apps and Documents sections that used to sit here were mock
 * rows that only ever appeared in mock mode; they were retired (Katerina,
 * 2026-09-05). APP_FILES / DOCUMENT_FILES stay in `src/data`: MessageBody
 * still resolves them, so reference chips in existing messages keep working.
 */
export const PeekReferenceTrigger = ReferenceTrigger.configure({
  items: () => mentionMessages().map(toReferenceItem),
  sections: referenceSections,
  iconFor: referenceRowIcon,
  subscribe: subscribeReferences,
  nodeName: 'messageMention',
  ...FILES_MENU_COPY,
  icon: FILES_MENU_ICON,
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

function ObjectMentionView({ node, editor, decorations }: NodeViewProps) {
  const uri: string = node.attrs.uri
  const storage = (editor.storage as unknown as { objectMention?: ObjectMentionStorage }).objectMention
  const supplied = storage?.supplied?.[uri] ?? storage?.supplied?.[uri.replace(/^nostr:/, '')]
  // Asked for only when nothing was handed in; the hook is called either way.
  const fetched = useResolvedReferences(supplied ? [] : [uri])
  const object = supplied ?? fetched[uri]
  return (
    <NodeViewWrapper as="span">
      {isRowOfDecorations(decorations) ? <RowInTheBox uri={uri} object={object} /> : <Reference uri={uri} object={object} link={false} />}
    </NodeViewWrapper>
  )
}

/**
 * An app URL in the composer, as the chip of what it names — OPT-19 (Miky,
 * 14 Oct: a message keeps the link as pasted, and every app link in the box
 * reads as its chip). The package's URL chip (`ReferenceNode` with `href`),
 * which `LinkChips` makes from a pasted, typed or passage URL and
 * `serializeInline` writes back as the URL; drawn as `objectMention` is, its
 * row alone on its line. A link to one block reads as its file's chip, with
 * the block live under the box (Decided 16 Oct). Until the URL is answered it
 * reads as the URL.
 */
function UrlChipView(props: NodeViewProps) {
  const href = typeof props.node.attrs.href === 'string' ? props.node.attrs.href : ''
  if (props.node.attrs.uri) return <ObjectMentionView {...props} />
  return <NodeViewWrapper as="span">{href}</NodeViewWrapper>
}

export const UrlChip = ReferenceNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(UrlChipView, { as: 'span' })
  },
})

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
