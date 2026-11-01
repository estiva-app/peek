import { useEffect, useReducer, useState } from 'react'
import { IconPlus } from '@tabler/icons-react'
import { CommandPalette, CommandPaletteSearch, EmptyState, KindIcon, SectionHeader, isApplePlatform, thingKindOf, type CommandPaletteRow } from '@estiva-app/ui'
import { fileChoices, subscribeReferences, useTopicFiles } from '@/api'
import { MessageCard } from '@/components/ui/MessageLinks'
import { referenceOfValue } from '@/lib/embedValue'
import { useToast } from '@/lib/toast'

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
 * Add file and the card's ✕ are where the prototype draws nothing yet, so they
 * take the kit's places for them: an action on the section's heading, the
 * attached card's Remove (Miky, 1 Nov: Katerina polishes after). Neither is
 * drawn on an archived topic, which is read-only in every app (why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-archived-file-is-read-only-in-every-app.md).
 *
 * Above Activity: Peek's Activity is every mention from elsewhere, as long as
 * it grows, and the topic's own files under it would scroll out of sight.
 */
export function TopicFiles({ topic, folder, title, readOnly }: {
  /** The topic's address. */
  topic: string
  /** Its Folder, from its root: where an entry is filed. */
  folder: string
  /** Its title, for the picker. */
  title: string
  /** Archived: the files show, with no Add file and no Remove. */
  readOnly: boolean
}) {
  const { state, busy, setListed } = useTopicFiles(topic, folder)
  const { showToast } = useToast()
  const [picking, setPicking] = useState(false)
  const files = typeof state === 'object' && 'files' in state ? state.files : []

  const change = async (file: string, listed: boolean) => {
    const result = await setListed(file, listed)
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
  }

  return (
    <div className="flex flex-col" data-topic-files={topic}>
      {/* The heading's 8px inset brought to the cards' 16px edge, as Activity's is. */}
      <div className="px-2 pt-4">
        <SectionHeader
          title="Files"
          count={files.length > 0 ? files.length : undefined}
          actions={readOnly ? undefined : [{ icon: <IconPlus size={16} stroke={1.5} />, tooltip: 'Add file', onClick: () => setPicking(true) }]}
          showActions="always"
        />
      </div>
      <div className="flex flex-col gap-3 px-4 pt-2">
        {state === 'loading' ? null : 'failed' in state ? (
          <EmptyState scope="section" message="Couldn’t load the files. Reload to try again." />
        ) : files.length === 0 ? (
          <EmptyState scope="section" message="None yet. A topic can be only a conversation." />
        ) : (
          files.map(({ file, address }) => {
            const uri = referenceOfValue(address)
            if (!uri) return null
            return (
              <div key={file} data-topic-file={address} className={busy.has(file) ? 'opacity-50' : undefined}>
                <MessageCard uri={uri} readOnly={readOnly} onRemove={readOnly || busy.has(file) ? undefined : () => void change(file, false)} />
              </div>
            )
          })
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
