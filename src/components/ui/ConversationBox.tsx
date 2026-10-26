import { createContext, useContext, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Editor, JSONContent } from '@tiptap/react'
import type { ForeignObject } from '@estiva-app/interop'
import { boxReadOf, composerDraft, composerText, embedsToSend, type ComposerLabels } from '@estiva-app/conversation'
import { referenceOfLink, type EditorDocument, type Embed } from '@estiva-app/protocol'
import { Kbd } from '@estiva-app/ui'
import {
  CommentBox,
  commentBoxRows,
  LinkChips,
  LinkPlaces,
  type BoxFile,
  type BoxSentUnder,
  type BoxUnder,
  type ReferenceViewProps,
  type SendAnswer,
  type UploadAnswer,
} from '@estiva-app/ui/editor'
import {
  askLinks,
  knownBlockOfUrl,
  knownCardValue,
  knownLinkTarget,
  mentionsVersion,
  referenceSections,
  subscribeMentions,
  subscribeReferences,
  useCanUpload,
  useResolvedReferences,
  useUploadActions,
  type HighlightType,
  type UploadedFile,
} from '@/api'
import { registerActiveComposer, unregisterComposer, type ComposerHandle } from '@/lib/composerRegistry'
import { browserDrafts, type DraftStore } from '@/lib/drafts'
import { referenceOfValue, valueOfReference } from '@/lib/embedValue'
import { HighlightTag } from '@/extensions/highlight'
import { ResolutionBlock, resolutionOfDocument } from '@/extensions/resolution'
import { RowInTheBox, referenceRowIcon } from '@/extensions/mention'
import { mentionDirectory } from './MentionMenu'
import { MessageCard, MessagePart } from './MessageLinks'
import { PartCard } from './PartCard'
import { Reference } from './Reference'
import { PEEK_INSERT_ROWS } from './SlashMenu'

/**
 * Peek's comment box: estiva-ui's `CommentBox`, the one box every app writes a
 * comment, a reply, a DM and a Folder's chat line in (PEEKM-3). What Peek adds
 * is only what Peek knows: its people for `@` and `!@`, its `[` sections, its
 * `/` row (Resolve; the Highlights wait for stage 2, `SlashMenu.tsx`), its upload, its drafts, its chips,
 * the launcher writing into the box last used, and a send through its own
 * actions that answers whether the relay took it.
 *
 * - **Shown at once** (Decided 2026-10-17): a send is drawn in the list before
 *   the relay answers (OPT-6), so the box empties at once; a refusal puts the
 *   words back with a line under the box saying why — no toast.
 * - **Under the box** while a message is written: the one file it names as the
 *   card it will be sent with, ✕ to take it off, and the live part of a block
 *   link, read by `boxReadOf` as Ship and Leaf read theirs.
 * - **Closed** (an archived file): a line saying why takes the box's place
 *   (Decided 2026-10-17).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/every-app-writes-and-reacts-with-one-shared-box.md
 */

/**
 * What a send carries to the conversation: the marker text, and what only
 * Peek's own nodes say beside it.
 */
export interface SendPayload {
  text: string
  resolution?: { message: string }
  highlightType?: HighlightType
  /** The pubkeys the `!@` mentions name (CON-17): the only place the urgency survives to the wire. */
  urgent?: string[]
  /** The files, already on the relay (CON-12). */
  files?: UploadedFile[]
  /** The one file's card, unless ✕ took it off (SPEC §13.6.2). */
  embeds?: Embed[]
}

/** What the relay said about a send: `{ accepted: false, reason }` puts the words back with "Not sent: reason". */
export type { SendAnswer }

export type BoxKind = 'conversation' | 'reply'

// Every app link reads as its chip, pasted, typed or inside a passage, and is sent as the URL it was (OPT-19).
// why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-is-stored-as-the-url-a-person-wrote.md
// A module constant, so the editor `keepCommentBoxWarm` built ahead is the one the next empty box takes.
export const BOX_EXTENSIONS = [
  LinkChips.configure({ referenceOf: (url: string) => referenceOfLink(url, knownLinkTarget), ask: askLinks }),
  // A line that is only a link draws its row as it is written, as the sent message will.
  LinkPlaces,
  ResolutionBlock,
  HighlightTag,
]

// The kit's triggers, then Peek's own (Katerina's order of 2026-09-04): Resolve. A highlight tag can still be
// read from a draft, but `/` no longer offers one until stage 2 gives it a place on the relay (PEEKM-3).
const INSERT = [commentBoxRows.file, commentBoxRows.mention, commentBoxRows.urgent, commentBoxRows.reference, ...PEEK_INSERT_ROWS]

/** How many of a box's links are asked about at once — `LinkChips`' default `limit`. */
const MAX_LINKS_ASKED = 24

const DEFAULT_DRAFTS = browserDrafts()

/*
  The links a box has asked about, and who hears when one is answered. Each
  URL is asked once: `read` runs on every keystroke and again on each answer,
  so asking a known URL again would answer again, and read again, for ever.
*/
const askedLinks = new Set<string>()
const linkListeners = new Set<() => void>()
const linksChanged = (listener: () => void) => {
  linkListeners.add(listener)
  return () => {
    linkListeners.delete(listener)
  }
}
const askAbout = (urls: readonly string[]) => {
  const fresh = urls.filter((url) => !askedLinks.has(url)).slice(0, MAX_LINKS_ASKED)
  if (fresh.length === 0) return
  for (const url of fresh) askedLinks.add(url)
  const heard = () => linkListeners.forEach((listener) => listener())
  askLinks(fresh).then(heard, heard)
}

type DocumentNode = { type?: string; attrs?: Record<string, unknown>; content?: DocumentNode[] }

/** The document without Peek's own nodes, which the message's text does not carry: the resolution and the highlight ride beside it. */
function withoutOwnNodes(node: DocumentNode): DocumentNode {
  if (!node.content) return node
  return { ...node, content: node.content.filter((child) => child.type !== 'resolutionBlock' && child.type !== 'highlightTag').map(withoutOwnNodes) }
}

function highlightOf(node: DocumentNode): HighlightType | undefined {
  if (node.type === 'highlightTag') return node.attrs?.highlightType as HighlightType
  for (const child of node.content ?? []) {
    const found = highlightOf(child)
    if (found) return found
  }
  return undefined
}

const hasHighlight = (editor: Editor) => {
  let found = false
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'highlightTag') found = true
    return !found
  })
  return found
}

/** What a box's seam already holds, for a surface with no relay to ask (a story, a test), by reference or address. */
const Supplied = createContext<Record<string, ForeignObject> | undefined>(undefined)

function suppliedFor(supplied: Record<string, ForeignObject> | undefined, uri: string): ForeignObject | undefined {
  if (!supplied) return undefined
  // By the file, not the spelling: a seam's `naddr` may carry relay hints the box's does not.
  const value = valueOfReference(uri.startsWith('nostr:') ? uri : `nostr:${uri}`)
  return Object.entries(supplied).find(([key]) => valueOfReference(key.startsWith('nostr:') ? key : `nostr:${key}`) === value)?.[1]
}

/** A file's card under the box, drawn as a sent message draws it. */
function BoxCard({ uri }: { uri: string }) {
  const resolved = suppliedFor(useContext(Supplied), uri)
  return <MessageCard uri={uri} resolved={resolved} />
}

/** What shows under the box while a message is written, read as it will be sent (why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md). */
function boxUnder(here: string | undefined): BoxUnder {
  return {
    read: (body) => {
      const links = boxReadOf(withoutOwnNodes(body as DocumentNode) as EditorDocument, { resolveLink: knownCardValue, blockOf: knownBlockOfUrl, here })
      askAbout(links.urls)
      const uri = links.card ? referenceOfValue(links.card) : undefined
      return {
        card: links.card && uri ? { value: links.card, view: <BoxCard uri={uri} /> } : undefined,
        parts: links.parts.map((part) => ({
          key: `${part.address}#${part.block}`,
          view: (
            <MessagePart>
              <PartCard address={part.address} block={part.block} />
            </MessagePart>
          ),
        })),
        names: [...links.values, ...links.parts.map((part) => part.address)],
      }
    },
    changed: linksChanged,
  }
}

/**
 * A `nostr:` reference or an app link the box holds, as the sent message's
 * chip — `Reference`, with `link={false}`: a click while writing is not a way
 * out of the draft. Alone on its line it draws its row, as it will once sent.
 * An app link not answered yet reads as the URL it was written as.
 */
export function BoxReference({ uri, href, place }: ReferenceViewProps) {
  const supplied = suppliedFor(useContext(Supplied), uri)
  // Asked for only when nothing was handed in; the hook is called either way.
  const fetched = useResolvedReferences(supplied || !uri ? [] : [uri])
  if (!uri) return <span>{href}</span>
  const object = supplied ?? fetched[uri]
  if (place === 'row' || place === 'card') return <RowInTheBox uri={uri} object={object} />
  return <Reference uri={uri} object={object} link={false} />
}

export interface ConversationBoxProps {
  kind?: BoxKind
  /**
   * Send it; answers whether the relay took it. `away` says, when the answer
   * comes, whether this box is gone — the person moved on, so a line under it
   * would go unseen.
   */
  onSend: (payload: SendPayload, away: () => boolean) => Promise<SendAnswer>
  /** Where an unsent message belongs — CON-10, built with `draftKeys`. Omitted, nothing is kept. */
  draftKey?: string
  /** The store. Injected so a test needs no browser; defaults to `localStorage`. */
  drafts?: DraftStore
  /** What the box writes to: its accessible name, and the command launcher's context chip. */
  contextLabel?: string
  /** The file whose conversation this box writes in: linking it adds no card here (§13.6.2). */
  here?: string
  /** Why nothing can be written here: the line in the box's place. */
  closed?: string
  /** Objects already resolved, by address — a story's or a test's seam. */
  resolvedObjects?: Record<string, ForeignObject>
  className?: string
}

/**
 * The box for writing a new message or reply, with text formatting, files,
 * highlights and Send; unsent text is kept for later.
 *
 * @registry namesake: Peek's wrapper of the package's CommentBox (PEEKM-3), as Ship's ConversationBox is.
 */
export function ConversationBox({ kind = 'conversation', onSend, draftKey, drafts = DEFAULT_DRAFTS, contextLabel, here, closed, resolvedObjects, className }: ConversationBoxProps) {
  const version = useSyncExternalStore(subscribeMentions, mentionsVersion)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the directory is replaced wholesale and counted by `version`
  const people = useMemo(() => mentionDirectory(), [version])
  const latestPeople = useRef(people)
  latestPeople.current = people
  const labels = useMemo<ComposerLabels>(() => ({ personLabel: (pubkey) => latestPeople.current.find((p) => p.pubkey === pubkey)?.name }), [])
  const draft = useMemo(() => (draftKey ? composerDraft(drafts, draftKey, labels) : undefined), [draftKey, drafts, labels])
  const under = useMemo(() => boxUnder(here), [here])

  const canUpload = useCanUpload()
  const { uploadFile } = useUploadActions()
  const upload = async (file: File): Promise<UploadAnswer> => {
    try {
      return { accepted: true, value: await uploadFile(file) }
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  const send = async (body: JSONContent, files: BoxFile[], shown: BoxSentUnder): Promise<SendAnswer> => {
    const doc = body as DocumentNode
    const resolution = resolutionOfDocument(doc)
    const { text, urgent } = composerText(withoutOwnNodes(doc) as EditorDocument)
    const uploaded = files.flatMap((f) => (f.value ? [f.value as UploadedFile] : []))
    // A highlight alone is no message.
    if (!text && !resolution.hasResolution && uploaded.length === 0) return { accepted: false, reason: 'there is nothing to send' }
    const embeds = embedsToSend({ card: shown.card }, new Set())
    // Gone once the box hands its editor back (`onEditor(null)`): the editor itself may live on, kept warm for the next box.
    const handle = registered.current
    const away = () => !handle || registered.current !== handle
    return onSend({
      text,
      resolution: resolution.hasResolution ? { message: resolution.resolutionMessage } : undefined,
      highlightType: highlightOf(doc),
      urgent,
      files: uploaded.length > 0 ? uploaded : undefined,
      embeds: embeds.length > 0 ? embeds : undefined,
    }, away)
  }

  /* The command launcher inserts into the box last used: focus wins, and the
     most recently drawn box is the fallback. A box going away hands back null. */
  const registered = useRef<(ComposerHandle & { onFocus: () => void }) | null>(null)
  const latestLabel = useRef(contextLabel)
  latestLabel.current = contextLabel
  const onEditor = (editor: Editor | null) => {
    const was = registered.current
    if (was) {
      was.editor.off('focus', was.onFocus)
      unregisterComposer(was.editor)
      registered.current = null
    }
    if (!editor) return
    // The label read when the launcher opens, so a topic renamed while its box is open is named as it is now.
    const handle = {
      editor,
      get label() {
        return latestLabel.current
      },
      onFocus: () => registerActiveComposer(handle),
    }
    editor.on('focus', handle.onFocus)
    registerActiveComposer(handle)
    registered.current = handle
  }

  return (
    <Supplied.Provider value={resolvedObjects}>
      <CommentBox
        key={draftKey}
        label={contextLabel ?? (kind === 'reply' ? 'Reply' : 'Message')}
        placeholder={<Placeholder kind={kind} />}
        people={people}
        references={referenceSections}
        referencesChanged={subscribeReferences}
        referenceIcon={(uri) => (uri ? referenceRowIcon(uri) : undefined)}
        referenceView={BoxReference}
        insert={INSERT}
        code="inline"
        draft={draft}
        extensions={BOX_EXTENSIONS}
        upload={canUpload ? upload : undefined}
        send={send}
        showsAtOnce
        under={under}
        closed={closed ? { reason: closed } : undefined}
        marked={hasHighlight}
        onEditor={onEditor}
        autoFocus
        className={className}
      />
    </Supplied.Provider>
  )
}

const NO_PEOPLE: readonly [] = []
const SENDS_NOTHING = async (): Promise<SendAnswer> => ({ accepted: false, reason: 'nothing can be written here' })

/** The box's place where nothing can be written (an archived file): the line saying why, as the box draws it in every app. */
export function ClosedBox({ reason }: { reason: string }) {
  return <CommentBox label="Message" placeholder={null} people={NO_PEOPLE} send={SENDS_NOTHING} closed={{ reason }} />
}

/** What the empty box says. */
function Placeholder({ kind }: { kind: BoxKind }) {
  if (kind === 'reply') return <span>Reply...</span>
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span>Start a new conversation or type</span>
      <Kbd>/</Kbd>
      <span>for commands</span>
    </span>
  )
}
