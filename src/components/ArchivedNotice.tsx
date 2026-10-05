import { IconArchive } from '@tabler/icons-react'
import { Banner } from '@estiva-app/ui'
import type { Archive } from '@estiva-app/interop'
import { formatDateLabel } from '@/api'

/**
 * The first thing an archived file or Folder shows (FOL-46): who archived it
 * and when, the resolution they gave, and Unarchive.
 *
 * A link still opens an archived file — it is out of every list, not gone — so
 * this is what stops it reading as live work. The resolution comes first,
 * under the line, because Miky's ask was exactly that: open an archived
 * project and read what happened to it before anything else. Ship's
 * `ArchivedNotice` says the same things in the same order.
 *
 * A file hidden **with** its parent (an issue of an archived project) is
 * restored there, not here, so it offers the way to that parent instead.
 *
 * The package's Banner in its `warning` tone (Katerina, 5 October), at the
 * top of the messages column: the line, the archive icon and the one action.
 * A Banner is one line, so the resolution is a block of its own under it,
 * with its own small label — it reads as what was said, not as more of the
 * line. Both sit on the panel's surface, since the page floats them over the
 * stream as it scrolls and Peek's warning wash is see-through.
 * @registry reusable: stays in Peek: estiva-ui's Banner with Peek's archive words
 */
export interface ArchivedNoticeProps {
  archive: Archive
  /** The archiver's name. */
  by: string
  /** "project", "folder" — what `archive.with` is, for "Archived with its project". */
  withWhat?: string
  /** Restore it. Absent when it is archived only with a parent, or cannot be restored from here. */
  onUnarchive?: () => void
  /** Open the parent it is archived with. */
  onOpenParent?: () => void
}

export function ArchivedNotice({ archive, by, withWhat, onUnarchive, onOpenParent }: ArchivedNoticeProps) {
  const when = formatDateLabel(archive.at * 1000)
  const line = archive.with
    ? `Archived with its ${withWhat ?? 'parent'} by ${by} · ${when}`
    : `Archived by ${by} · ${when}`
  const action = archive.with
    ? onOpenParent && { label: `Open ${withWhat ?? 'parent'}`, onClick: onOpenParent }
    : onUnarchive && { label: 'Unarchive', onClick: onUnarchive }
  return (
    <div className="flex flex-col bg-bg-surface">
      <Banner tone="warning" icon={<IconArchive size={16} stroke={1.5} />} {...(action ? { action } : {})}>
        {line}
      </Banner>
      {archive.resolution && (
        <div className="flex flex-col gap-1 border-b border-border-subtle px-4 py-3">
          <span className="text-caption text-text-muted">Resolution</span>
          <p className="whitespace-pre-wrap text-body-2 text-text-primary">{archive.resolution}</p>
        </div>
      )}
    </div>
  )
}
