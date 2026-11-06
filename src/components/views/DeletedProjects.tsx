import { useState } from 'react'
import { IconTrash } from '@tabler/icons-react'
import { EmptyState, MetaText, NavItem, SkeletonList } from '@estiva-app/ui'
import { prevOf, type ForeignObject } from '@estiva-app/interop'
import { formatDateLabel, useWorkspaceDirectory, type DeletedProjectsState } from '@/api'
import { Button } from '@/components/ui/Button'
import { DELETED_FIELD } from '@/lib/fileControls'
import { filePath } from '@/lib/objectUrl'

/**
 * Archive's Deleted tab (ALO-6; Miky, 6 Nov; the story `Project changes` › Archived view): one list of every deleted
 * project the viewer can see, newest deleted first. Each row says its team, who deleted it and when, and offers
 * Restore where the project's manifest declares Delete as a change of its `deleted` field — a project deleted any
 * other way cannot be brought back from here.
 */
export function DeletedProjects({
  state,
  teamOf,
  selectedRef,
  onRestore,
  onRetry,
}: {
  state: Exclude<DeletedProjectsState, 'unavailable'>
  /** Read them again, after a read that failed. */
  onRetry: () => Promise<void>
  /** The name of the team a project is in, as the Teams column says it. */
  teamOf: (file: ForeignObject) => string | undefined
  selectedRef?: string
  /** Restore it: resolves once written and the list is read again, or once a refusal is shown; never rejects. */
  onRestore: (file: ForeignObject, actionId: string, prev: string | undefined) => Promise<void>
}) {
  const people = useWorkspaceDirectory()
  if (state === 'loading') return <SkeletonList />
  if (state === 'error')
    return <EmptyState scope="section" message="Deleted projects could not be read." action={{ label: 'Try again', onClick: () => void onRetry() }} />
  if (state.length === 0) return <EmptyState scope="section" message="Nothing deleted." />
  return (
    <ul className="flex flex-col">
      {state.map((file) => {
        const deleted = file.deleted!
        // A dash for a person nobody has named, as the kit's Person draws one: never their key.
        const by = people?.[deleted.by]?.displayName ?? file.people?.[deleted.by]?.displayName ?? '—'
        // The Delete that is a change of `deleted`, even beside a confirm-style one: only it can be undone.
        const action = file.actions.find((candidate) => candidate.field === DELETED_FIELD)
        return (
          <DeletedRow
            key={file.ref}
            file={file}
            caption={[teamOf(file), `Deleted by ${by} · ${formatDateLabel(deleted.at * 1000)}`].filter(Boolean).join(' · ')}
            active={file.ref === selectedRef}
            restore={action?.field && file.naddr ? () => onRestore(file, action.id, prevOf(file, action.field!)) : undefined}
          />
        )
      })}
    </ul>
  )
}

function DeletedRow({
  file,
  caption,
  active,
  restore,
}: {
  file: ForeignObject
  caption: string
  active: boolean
  restore?: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const title = file.slots.title?.value || 'Untitled'
  return (
    <li data-file={file.ref}>
      <NavItem
        href={file.address ? filePath(file.address, title) : '#'}
        label={title}
        icon={<IconTrash size={16} stroke={1.5} />}
        active={active}
      />
      {/* Under the title, past its icon: the column holds one line, so who and when go on a line of their own. */}
      <div className="flex items-center gap-2 pb-2 pl-8 pr-2">
        <span className="min-w-0 flex-1 truncate">
          <MetaText>{caption}</MetaText>
        </span>
        {restore && (
          <Button
            variant="outlined"
            size="small"
            className="shrink-0"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              // The row leaves the list once restored; on a refusal it stays, with the button back.
              void restore().finally(() => setBusy(false))
            }}
          >
            Restore
          </Button>
        )}
      </div>
    </li>
  )
}
