import { createContext, useContext, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import type { Editor, JSONContent } from '@tiptap/react'
import { MAX_LINKS_ASKED, type ForeignObject } from '@estiva-app/interop'
import {
  boxReadOf,
  composerDocument,
  composerDraft,
  composerText,
  embedsToEdit,
  embedsToSend,
  namedBefore,
  withoutNewUrgency,
  type ComposerLabels,
} from '@estiva-app/conversation'
import { referenceOfLink, type EditorDocument, type Embed } from '@estiva-app/protocol'
import { Kbd, LinkChip } from '@estiva-app/ui'
import {
  CommentBox,
  commentBoxRows,
  LinkChips,
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
  onLinksChanged,
  mentionsVersion,
  personByPubkey,
  referenceSections,
  subscribeMentions,
  subscribeReferences,
  useCanUpload,
  useResolvedReferences,
  useUploadActions,
  type FileAttachment,
  type HighlightType,
  type UploadedFile,
} from '@/api'
import { registerActiveComposer, unregisterComposer, type ComposerHandle } from '@/lib/composerRegistry'
import { browserDrafts, type DraftStore } from '@/lib/drafts'
import { referenceOfValue, valueOfReference } from '@/lib/embedValue'
import { isWebLink } from '@/lib/referenceLink'
import type { RefusedEdit } from '@/lib/refusedEdits'
import { HighlightTag } from '@/extensions/highlight'
import { extractResolutionFromText, ResolutionBlock, resolutionOfDocument } from '@/extensions/resolution'
import { referenceRowIcon } from '@/extensions/mention'
import { linkStateOf } from '@/lib/linked'
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
// No `LinkPlaces`: in a message's box every link is a chip while it is written, alone on its line too; its row, or
// nothing behind its card, comes once it is sent (the kit's `LinkPlaces` page; Katerina, 30 Oct).
// A module constant, so the editor `keepCommentBoxWarm` built ahead is the one the next empty box takes.
export const BOX_EXTENSIONS = [
  LinkChips.configure({ referenceOf: (url: string) => referenceOfLink(url, knownLinkTarget), ask: askLinks }),
  ResolutionBlock,
  HighlightTag,
]

// The kit's triggers, then Peek's own (Katerina's order of 2026-09-04): Resolve. A highlight tag can still be
// read from a draft, but `/` no longer offers one until stage 2 gives it a place on the relay (PEEKM-3).
const INSERT = [commentBoxRows.file, commentBoxRows.mention, commentBoxRows.urgent, commentBoxRows.reference, ...PEEK_INSERT_ROWS]

const DEFAULT_DRAFTS = browserDrafts()

/*
  Ask what a box's links name, the first `MAX_LINKS_ASKED` — `LinkChips`' own
  limit. `read` runs on every keystroke and again on each answer: the link
  reader asks each URL once, so a known one answers nothing new, and one whose
  read failed is asked again only once the reader says it may be.
*/
const askAbout = (urls: readonly string[]) => {
  const web = urls.filter(isWebLink)
  if (web.length) askLinks(web.slice(0, MAX_LINKS_ASKED)).catch(() => {})
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

const LINK_CONTEXT = { resolveLink: knownCardValue, blockOf: knownBlockOfUrl }

/** What a box's document names, read as it will be sent; `previous` makes it an edit's, where only a file named first gets a card. */
const linksOfBox = (body: JSONContent, here: string | undefined, previous?: readonly string[]) =>
  boxReadOf(withoutOwnNodes(body as DocumentNode) as EditorDocument, { ...LINK_CONTEXT, here, previous })

/** What shows under the box while a message is written, read as it will be sent (why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md). */
function boxUnder(here: string | undefined, previous?: readonly string[]): BoxUnder {
  return {
    read: (body) => {
      const links = linksOfBox(body, here, previous)
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
    changed: onLinksChanged,
  }
}

const isPerson = (uri: string) => /^nostr:npub1/i.test(uri)

/** A click on the chip's link while writing is held: it is not a way out of the draft. */
const holdLink = (event: MouseEvent) => {
  if ((event.target as Element).closest('a')) event.preventDefault()
}

/**
 * A `nostr:` reference or an app link the box holds, as the kit's `LinkChip`,
 * from the same lookup the sent message's chip reads (Katerina, 30 Oct: one
 * chip in every box, for a pasted link and a `[` pick alike). A chip wherever it
 * sits. While writing a click does not follow it and hovering shows no card. A
 * person is their name's chip, as in the sent message. An app link not
 * answered yet reads as the URL it was written as.
 */
export function BoxReference({ uri, href }: ReferenceViewProps) {
  const supplied = suppliedFor(useContext(Supplied), uri)
  // Asked for only when nothing was handed in, and never for a person, whom the directory names; the hook is called either way.
  const fetched = useResolvedReferences(supplied || !uri || isPerson(uri) ? [] : [uri])
  if (!uri) return <span>{href}</span>
  if (isPerson(uri)) return <Reference uri={uri} link={false} />
  return (
    <span onClickCapture={holdLink} onAuxClickCapture={holdLink}>
      <LinkChip link={linkStateOf(uri, supplied ?? fetched[uri])} preview={false} />
    </span>
  )
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
/** Who `@` and `!@` offer, and how a `nostr:npub…` in marker text is named again as a chip. */
function usePeople() {
  const version = useSyncExternalStore(subscribeMentions, mentionsVersion)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the directory is replaced wholesale and counted by `version`
  const people = useMemo(() => mentionDirectory(), [version])
  const latestPeople = useRef(people)
  latestPeople.current = people
  // Anyone Peek can name, not only those `@` offers: a message may name somebody seen only on the relay.
  const labels = useMemo<ComposerLabels>(
    () => ({ personLabel: (pubkey) => latestPeople.current.find((p) => p.pubkey === pubkey)?.name ?? personByPubkey(pubkey)?.name }),
    [],
  )
  return { people, labels }
}

/** Peek's upload, as the box asks for one; absent where nothing can be uploaded. */
function useUpload(): ((file: File) => Promise<UploadAnswer>) | undefined {
  const canUpload = useCanUpload()
  const { uploadFile } = useUploadActions()
  if (!canUpload) return undefined
  return async (file) => {
    try {
      return { accepted: true, value: await uploadFile(file) }
    } catch (error) {
      return { accepted: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }
}

export function ConversationBox({ kind = 'conversation', onSend, draftKey, drafts = DEFAULT_DRAFTS, contextLabel, here, closed, resolvedObjects, className }: ConversationBoxProps) {
  const { people, labels } = usePeople()
  const draft = useMemo(() => (draftKey ? composerDraft(drafts, draftKey, labels) : undefined), [draftKey, drafts, labels])
  const under = useMemo(() => boxUnder(here), [here])
  const upload = useUpload()

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
        upload={upload}
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

/** What an edit saved, for the card to show at once; the card's handlers write it as one edit. */
export interface EditSaved {
  /** The new text, only when it changed. */
  text?: string
  /** The resolution the box was saved with. */
  resolution: { hasResolution: boolean; resolutionMessage: string }
  highlightType?: HighlightType
  /** The whole file list, only when this edit changed it (PEE-16). */
  files?: FileAttachment[]
  /** The card set, only when this edit names a file first (§13.6.2). */
  embeds?: Embed[]
}

export interface EditBoxProps {
  kind?: BoxKind
  /** The message as it stands. `resolution` when it is resolved (or, for a reply, when it resolved its conversation). */
  message: {
    body: string
    urgent?: readonly string[]
    highlightType?: HighlightType
    resolution?: { message: string }
    files?: readonly FileAttachment[]
    embeds?: readonly Embed[]
  }
  /** A save the relay refused, to open with instead (OPT-8): its text, its files, and why, said under the box. */
  refused?: RefusedEdit
  /** The file whose conversation it is in: linking it adds no card (§13.6.2). */
  here?: string
  /** Called with what was saved, at once: the card shows it before the relay answers. */
  onSave: (saved: EditSaved) => void
  onCancel: () => void
  /** Objects already resolved, by address — a story's or a test's seam. */
  resolvedObjects?: Record<string, ForeignObject>
  className?: string
}

const sameFiles = (a: readonly FileAttachment[], b: readonly FileAttachment[]) =>
  a.length === b.length && a.every((f, i) => (f.sha256 ?? f.name) === (b[i].sha256 ?? b[i].name))

/** The box's record of a file: a message's own `FileAttachment`, or what `uploadFile` answered. */
function attachmentOf(value: unknown): FileAttachment {
  const f = value as UploadedFile
  return { name: f.name, contentType: f.contentType, size: f.size, previewUrl: f.previewUrl, sha256: f.sha256, mediaUrl: f.mediaUrl, thumbUrl: f.thumbUrl }
}

/**
 * Editing a comment or a reply you wrote: the shared box's edit mode (PEEKM-4),
 * with Peek's people, `[`, chips and upload. It shows at once, as a send does
 * (why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-refused-action-is-undone-and-your-text-comes-back.md):
 * Save hands the card what changed and the box closes; a refusal reopens it,
 * as a new box, with what was saved and "Not saved: …" under it. A file can be
 * added while editing (Miky, 26 Oct), and the highlight and the resolution the
 * message has open in the box and are kept.
 */
export function EditBox({ kind = 'conversation', message, refused, here, onSave, onCancel, resolvedObjects, className }: EditBoxProps) {
  const { people, labels } = usePeople()
  const upload = useUpload()
  // What the message named before, so only a file this edit names first gets a card.
  const [previous] = useState(() => namedBefore(message.body, LINK_CONTEXT))
  const under = useMemo(() => boxUnder(here, previous), [here, previous])

  // Read once, as the box opens: a re-read of the message while editing does not reset what is typed.
  const [edit] = useState(() => {
    const doc = composerDocument(refused?.text ?? message.body, labels, message.urgent) as DocumentNode
    const content = [...(doc.content ?? [])]
    const first = content[0]
    if (message.highlightType && first?.type === 'paragraph') {
      content[0] = { ...first, content: [{ type: 'highlightTag', attrs: { highlightType: message.highlightType } }, { type: 'text', text: ' ' } as DocumentNode, ...(first.content ?? [])] }
    }
    // Taking the block out reopens it; emptying its words keeps it resolved with none.
    if (message.resolution) {
      content.push({ type: 'resolutionBlock', content: [{ type: 'text', text: `→ ${message.resolution.message}` } as DocumentNode] })
    }
    const files: BoxFile[] = (refused?.files ?? message.files ?? []).map((f, i) => ({
      id: `kept-${i}`,
      name: f.name,
      size: f.size,
      contentType: f.contentType,
      state: 'ready',
      value: f,
    }))
    return { body: { ...doc, content } as JSONContent, files }
  })

  const save = async (body: JSONContent, files: BoxFile[], shown: BoxSentUnder): Promise<SendAnswer> => {
    const doc = body as DocumentNode
    let resolution = resolutionOfDocument(doc)
    let { text } = composerText(withoutOwnNodes(doc) as EditorDocument)
    // A start-of-line "-> words" the input rule did not turn into the block (pasted) still resolves; mid-line arrows are prose.
    if (!resolution.hasResolution) {
      const fromText = extractResolutionFromText(text)
      if (fromText) {
        text = fromText.body
        resolution = { hasResolution: true, resolutionMessage: fromText.resolutionMessage }
      }
    }
    const kept = files.flatMap((f) => (f.value ? [attachmentOf(f.value)] : []))
    if (!text && kept.length === 0 && !resolution.hasResolution) return { accepted: false, reason: 'a message needs words or a file; Delete removes it' }
    // An edit makes nobody urgent (CON-24).
    text = withoutNewUrgency(text, message.body)
    const links = linksOfBox(body, here, previous)
    onSave({
      text: text !== message.body.trim() ? text : undefined,
      resolution,
      highlightType: highlightOf(doc),
      files: sameFiles(kept, message.files ?? []) ? undefined : kept,
      embeds: embedsToEdit(links, new Set(links.card && links.card !== shown.card ? [links.card] : []), message.embeds),
    })
    return { accepted: true }
  }

  return (
    <Supplied.Provider value={resolvedObjects}>
      <CommentBox
        label={kind === 'reply' ? 'Edit reply' : 'Edit message'}
        placeholder="Edit message"
        people={people}
        references={referenceSections}
        referencesChanged={subscribeReferences}
        referenceIcon={(uri) => (uri ? referenceRowIcon(uri) : undefined)}
        referenceView={BoxReference}
        insert={INSERT}
        code="inline"
        extensions={BOX_EXTENSIONS}
        upload={upload}
        send={save}
        under={under}
        edit={{ body: edit.body, files: edit.files, writesFiles: true, refused: refused?.reason, onCancel, onSave: save }}
        marked={hasHighlight}
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
