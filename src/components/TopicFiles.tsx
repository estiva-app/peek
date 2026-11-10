import { useEffect, useReducer, useState } from 'react'
import { IconArchive, IconPlus } from '@tabler/icons-react'
import { CollapsibleSection, CommandPalette, CommandPaletteSearch, CornerMenu, EmptyState, KindIcon, SectionHeader, isApplePlatform, thingKindOf, type CommandPaletteRow } from '@estiva-app/ui'
import type { FileLook } from '@estiva-app/interop'
import { fileChoices, subscribeReferences, type TopicFile, type useTopicFiles } from '@/api'
import { MessageCard } from '@/components/ui/MessageLinks'
import { referenceOfValue } from '@/lib/embedValue'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/**
 * **A topic's files, in its Overview column** (TOP-3; why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-topic-keeps-its-own-list-of-files.md).
 *
 * The files the topic lists, from any Folder, each as the kit's card the way
 * Peek draws one under a message: its title opens it in its own app. As the
 * Per app prototype draws them (estiva-ui `concept/cross-app-navigation`,
 * `Lens.tsx` PeekTopic's Files column), with no app label: the card says what
 * it is.
 *
 * In the topic's own order, each as a row or a card, the same for everyone
 * (TOPI-5; why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/each-file-on-a-topic-keeps-its-own-place-and-look.md):
 * a file is dragged to its place, and its "…" shows it as a row or a card, or
 * removes it, with Undo. Add file is an action on the section's heading. None
 * of these is drawn on an archived topic, which is read-only in every app (why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-archived-file-is-read-only-in-every-app.md),
 * nor for someone who cannot add a file here.
 *
 * Its archived files, on their own or with a file above them, wait at the end
 * behind one closed "Archived · n" line (TOPI-10, the approved story): since
 * the Topics column lists topics flat, this is where they are found.
 *
 * Above Activity: Peek's Activity is every mention from elsewhere, as long as
 * it grows, and the topic's own files under it would scroll out of sight.
 */
export function TopicFiles({ topic, files: read, title, readOnly, mayChange = true }: {
  /** The topic's address. */
  topic: string
  /**
   * Its list and the writes on it (`useTopicFiles`), read by the topic's view: at All its middle column draws the
   * same files' conversations, so the list is read once for both (TOPI-3).
   */
  files: ReturnType<typeof useTopicFiles>
  /** Its title, for the picker. */
  title: string
  /** Archived: the files show, with no Add file and no Remove. */
  readOnly: boolean
  /** The viewer may add a file here (`mayChangeTopicIn`), and so arrange them: without it, no Add file, no "…", no drag. */
  mayChange?: boolean
}) {
  const { state, busy, setListed, move, setLook, putBack } = read
  const { showToast } = useToast()
  const [picking, setPicking] = useState(false)
  // The file being dragged, and where it would land: before the live file at that index (the length: after the last).
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const files = typeof state === 'object' && 'files' in state ? state.files : []
  const live = files.filter((file) => !file.archived)
  const archived = files.filter((file) => file.archived)
  const changes = !readOnly && mayChange

  const change = async (file: string, listed: boolean) => {
    const result = await setListed(file, listed)
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
  }
  const told = (result: { ok: true } | { ok: false; reason: string }) => {
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
  }

  // Remove, with Undo bringing it back where it was, as it looked (TOPI-5): the file before it in the topic's own order.
  const remove = async (gone: TopicFile) => {
    const at = files.findIndex((f) => f.file === gone.file)
    const after = at > 0 ? files[at - 1].file : null
    const result = await setListed(gone.file, false)
    if (!result.ok) return showToast({ label: result.reason, type: 'error' })
    showToast({ label: `Removed “${nameOf(gone)}”`, type: 'success', actionLabel: 'Undo', onAction: () => void putBack(gone.listed, after).then(told) })
  }

  const drop = () => {
    const from = live.findIndex((f) => f.file === dragging)
    const to = dropAt
    setDragging(null)
    setDropAt(null)
    // Dropped where it already is: nothing moves.
    if (from < 0 || to === null || to === from || to === from + 1) return
    void move(live[from].file, to === 0 ? null : live[to - 1].file).then(told)
  }

  return (
    <div className="flex flex-col" data-topic-files={topic}>
      {/* The heading's 8px inset brought to the cards' 16px edge, as Activity's is: the room on the heading itself. No count: the files are right under it (TOPI-5). */}
      <SectionHeader
        title="Files"
        actions={changes ? [{ icon: <IconPlus size={16} stroke={1.5} />, tooltip: 'Add file', onClick: () => setPicking(true) }] : undefined}
        showActions="always"
        className="mx-2 mt-4"
      />
      <div className="flex flex-col gap-3 px-4 pt-2">
        {state === 'loading' ? null : 'failed' in state ? (
          <EmptyState scope="section" message="Couldn’t load the files. Reload to try again." />
        ) : files.length === 0 ? (
          <EmptyState scope="section" message="None yet. A topic can be only a conversation." />
        ) : (
          <>
            {live.map((entry, index) => {
              const { file, address } = entry
              const uri = referenceOfValue(address)
              if (!uri) return null
              const look = lookOf(entry)
              const arrangeable = changes && !busy.has(file)
              /*
                The whole file is dragged, no grip, so the files keep their alignment; its "…" floats over its corner
                (Miky, 6 Nov). A drop line in the gap says where it lands, in the accent the editor's drop line uses.
              */
              return (
                <div
                  key={file}
                  data-topic-file={address}
                  className={cn('relative', (busy.has(file) || dragging === file) && 'opacity-50')}
                  draggable={arrangeable}
                  onDragStart={(event) => {
                    // A link inside a file that cannot be moved still drags as a link, and moves nothing here.
                    if (!arrangeable) return
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', address)
                    event.dataTransfer.setDragImage(event.currentTarget, 16, 16)
                    setDragging(file)
                  }}
                  onDragEnd={() => {
                    setDragging(null)
                    setDropAt(null)
                  }}
                  onDragOver={(event) => {
                    if (!dragging) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    const box = event.currentTarget.getBoundingClientRect()
                    setDropAt(event.clientY < box.top + box.height / 2 ? index : index + 1)
                  }}
                  onDrop={(event) => {
                    if (!dragging) return
                    event.preventDefault()
                    drop()
                  }}
                >
                  {dragging && dropAt === index && <DropLine at="top" />}
                  <CornerMenu
                    menu={
                      arrangeable
                        ? { name: nameOf(entry), look, onLook: (next) => void setLook(file, next).then(told), onRemove: () => void remove(entry) }
                        : undefined
                    }
                  >
                    <MessageCard uri={uri} compact={look === 'row'} readOnly={readOnly} />
                  </CornerMenu>
                  {dragging && dropAt === live.length && index === live.length - 1 && <DropLine at="bottom" />}
                </div>
              )
            })}
            {archived.length > 0 && (
              // The kit's folding row, closed: out of the way, one press from here (Miky, 6 Nov). Read-only inside, as an archived file is everywhere.
              <CollapsibleSection
                look="row"
                title={`Archived · ${archived.length}`}
                icon={<IconArchive size={16} stroke={1.5} />}
                defaultOpen={false}
                contentClassName="flex flex-col gap-3 pt-2"
              >
                {archived.map(({ file, address }) => {
                  const uri = referenceOfValue(address)
                  return uri ? (
                    <div key={file} data-topic-file={address}>
                      <MessageCard uri={uri} readOnly />
                    </div>
                  ) : null
                })}
              </CollapsibleSection>
            )}
          </>
        )}
      </div>
      {picking && (
        <AddFileDialog
          title={title}
          listed={files.map((f) => f.address)}
          onPick={(file) => {
            setPicking(false)
            void change(file, true)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}

/** What a file is called, for its "…" and the Removed toast. */
const nameOf = (file: TopicFile): string => file.object?.slots.title?.value || 'File'

/**
 * How a file shows (TOPI-5): the look somebody chose on this topic, else as its
 * own app says, the first row or card in its manifest's widget chain (a project
 * and a Leaf page as cards, an issue as a row; Miky, 9 Nov), else a card.
 */
export function lookOf(file: TopicFile): FileLook {
  if (file.listed.look) return file.listed.look
  const chain = file.object ? [file.object.widget].flat() : []
  return chain.find((widget): widget is FileLook => widget === 'row' || widget === 'card') ?? 'card'
}

/** Where a dragged file lands: a line in the 12px gap above or below the file, centred in it. */
function DropLine({ at }: { at: 'top' | 'bottom' }) {
  return <div aria-hidden className={cn('pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-accent-primary', at === 'top' ? '-top-2' : '-bottom-2')} />
}

/** How long "Searching files…" waits for an answer that may already be held, ms. */
const SEARCH_SETTLE_MS = 3000

/**
 * Add file's picker: `[`'s Files in the kit's palette — this Folder's files,
 * then the ones you read lately, then the relay's search once you type — with
 * no topics and none the topic already lists (Miky, 1 Nov, TOP-3's kickoff).
 */
function AddFileDialog({ title, listed, onPick, onClose }: {
  title: string
  /** The addresses the topic lists already. */
  listed: readonly string[]
  /** The picked file's id. */
  onPick: (file: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  // The tiers are held outside React: a search answer landing draws the list again.
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  /*
    What was typed last, until an answer lands for it: "Searching…" rather than
    "Nothing is called …" before the relay has said so. An answer already held
    lands no news, so the line gives way after a few seconds anyway.
  */
  const [waitingFor, setWaitingFor] = useState<string | null>(null)
  useEffect(
    () =>
      subscribeReferences(() => {
        setWaitingFor(null)
        redraw()
      }),
    [],
  )
  useEffect(() => {
    if (!waitingFor) return
    const settle = setTimeout(() => setWaitingFor(null), SEARCH_SETTLE_MS)
    return () => clearTimeout(settle)
  }, [waitingFor])
  const rows: CommandPaletteRow[] = fileChoices(query, listed).map((candidate) => ({
    id: candidate.id,
    label: candidate.title,
    ...(candidate.summary ? { description: candidate.summary, aside: candidate.caption || undefined } : candidate.caption ? { description: candidate.caption } : {}),
    icon: <KindIcon kind={thingKindOf(candidate.kind)} tone="inherit" />,
    // A file's id is its address's `d`, what the topic's entry names.
    onSelect: () => onPick(candidate.id.split(':').slice(2).join(':')),
  }))
  return (
    <CommandPalette open onOpenChange={(open) => !open && onClose()} label={`Add a file to ${title}`} where={title} modKey={isApplePlatform() ? 'Cmd' : 'Ctrl'}>
      <CommandPaletteSearch
        query={query}
        onQueryChange={(next) => {
          setQuery(next)
          setWaitingFor(next.trim() ? next : null)
        }}
        placeholder="Find a project, issue or document…"
        groups={[{ label: 'Files', rows }]}
        pending={waitingFor === query && rows.length === 0 ? 'Searching files…' : undefined}
        empty={waitingFor === query && rows.length === 0 ? undefined : query ? `Nothing is called “${query}”.` : 'Type to find a file.'}
      />
    </CommandPalette>
  )
}
