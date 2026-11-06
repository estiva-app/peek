import { useState, type DragEvent } from 'react'
import { IconArchive, IconDots, IconPlus } from '@tabler/icons-react'
import { CollapsibleSection, EmptyState, IconButton, Menu, MenuItem, MenuSeparator, SectionHeader } from '@estiva-app/ui'
import { MessageCard } from '@/components/ui/MessageLinks'
import { referenceOfValue } from '@/lib/embedValue'
import { cn } from '@/lib/utils'
import { useToast } from '@/lib/toast'
import { FILES, type Look, type Read, type Topic } from './fixtures'

/**
 * **A topic's files, in its Overview** — a copy of `TopicFiles`
 * (`src/components/TopicFiles.tsx`), changed only where this project changes it
 * (Miky, 3 and 6 Nov):
 *
 * - **Drag the file itself** to reorder; a line shows where it lands. No grip,
 *   so the files keep their alignment, and a click on the file still opens it.
 * - The ✕ that floats over a card's top-right corner on hover is now a **"…"**
 *   in the same place, taking no room: Show as row, Show as card (the one in
 *   use selected), and Remove, with Undo. No Move up or Move down.
 * - Each file is a row or a card, the topic's choice (today every file is a
 *   card).
 * - **"Files" has no count.**
 * - Archived files wait at the end behind one **"Archived · N"** line.
 * - Whoever can't add a file (not a member, an archived topic) can't drag and
 *   gets no "…", as today they get no Add file and no ✕.
 *
 * The card and the row are today's (`MessageCard`, the kit's card or row the
 * way Peek draws a file under a message), as are Add file, and the empty and
 * failed lines.
 */
export function TopicFiles({ topic, read, readOnly }: {
  topic: Topic
  read: Read
  /** You can't add a file here: no Add file, no drag, no "…". */
  readOnly: boolean
}) {
  const [files, setFiles] = useState(topic.files)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const { showToast } = useToast()
  const live = files.filter((f) => !FILES[f.id]!.archived)
  const gone = files.filter((f) => FILES[f.id]!.archived)

  const setLook = (id: string, look: Look) => setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, look } : f)))
  const remove = (id: string) => {
    const before = files
    setFiles((fs) => fs.filter((f) => f.id !== id))
    showToast({ label: `Removed from ${topic.title}`, actionLabel: 'Undo', onAction: () => setFiles(before) })
  }
  const over = (index: number) => (event: DragEvent<HTMLDivElement>) => {
    if (!dragging) return
    event.preventDefault()
    const box = event.currentTarget.getBoundingClientRect()
    setDropAt(event.clientY < box.top + box.height / 2 ? index : index + 1)
  }
  const drop = () => {
    if (dragging && dropAt !== null) {
      const from = live.findIndex((f) => f.id === dragging)
      const next = [...live]
      const [moved] = next.splice(from, 1)
      next.splice(dropAt > from ? dropAt - 1 : dropAt, 0, moved!)
      setFiles([...next, ...gone])
    }
    setDragging(null)
    setDropAt(null)
  }

  const card = (id: string, look: Look, cardReadOnly: boolean) => {
    const file = FILES[id]!
    const uri = referenceOfValue(file.address!)
    return uri ? <MessageCard uri={uri} resolved={file} compact={look === 'row'} readOnly={cardReadOnly} /> : null
  }

  return (
    <div className="flex flex-col" data-topic-files={topic.file.address}>
      <SectionHeader
        title="Files"
        actions={readOnly ? undefined : [{ icon: <IconPlus size={16} stroke={1.5} />, tooltip: 'Add file', onClick: () => {} }]}
        showActions="always"
        className="mx-2 mt-4"
      />
      <div
        className="flex flex-col gap-3 px-4 pt-2"
        onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node) && setDropAt(null)}
      >
        {read === 'loading' ? null : read === 'failed' ? (
          <EmptyState scope="section" message="Couldn’t load the files. Reload to try again." />
        ) : files.length === 0 ? (
          <EmptyState scope="section" message="None yet. A topic can be only a conversation." />
        ) : (
          <>
            {live.map((f, index) => (
              <div
                key={f.id}
                data-topic-file={FILES[f.id]!.address}
                className={cn('group/file relative max-w-[480px]', dragging === f.id && 'opacity-40')}
                draggable={!readOnly}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  setDragging(f.id)
                }}
                onDragEnd={() => {
                  setDragging(null)
                  setDropAt(null)
                }}
                onDragOver={readOnly ? undefined : over(index)}
                onDrop={readOnly ? undefined : drop}
              >
                {dropAt === index && <DropLine at="top" />}
                {card(f.id, f.look, readOnly)}
                {!readOnly && (
                  /* NEW HERE. Where the card's ✕ floats today (the kit's RemoveBadge): over its top-right corner, on hover. */
                  <div className="absolute -right-2 -top-2 z-10 rounded-md border border-border-strong bg-bg-elevated opacity-0 shadow-sm transition-opacity group-hover/file:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100">
                    <Menu
                      align="right"
                      trigger={
                        <IconButton tooltip="More options" aria-label={`More options for ${FILES[f.id]!.slots.title?.value}`}>
                          <IconDots size={16} stroke={1.5} />
                        </IconButton>
                      }
                    >
                      <MenuItem label="Show as row" selected={f.look === 'row'} onClick={() => setLook(f.id, 'row')} />
                      <MenuItem label="Show as card" selected={f.look === 'card'} onClick={() => setLook(f.id, 'card')} />
                      <MenuSeparator />
                      <MenuItem label="Remove" onClick={() => remove(f.id)} />
                    </Menu>
                  </div>
                )}
                {dropAt === index + 1 && index === live.length - 1 && <DropLine at="bottom" />}
              </div>
            ))}
            {gone.length > 0 && (
              // The kit's folding row, as an archived section folds elsewhere; read-only inside.
              <CollapsibleSection look="row" title={`Archived · ${gone.length}`} icon={<IconArchive size={16} stroke={1.5} />} defaultOpen={false} contentClassName="flex flex-col gap-3 pt-2">
                {gone.map((f) => (
                  <div key={f.id} className="max-w-[480px]">
                    {card(f.id, f.look, true)}
                  </div>
                ))}
              </CollapsibleSection>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** NEW HERE. Where a dragged file lands: the document block's drop line (the kit's BlockHandle), in the 12px between two files. */
function DropLine({ at }: { at: 'top' | 'bottom' }) {
  return <span aria-hidden className={cn('pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-accent-primary', at === 'top' ? '-top-2' : '-bottom-2')} />
}
