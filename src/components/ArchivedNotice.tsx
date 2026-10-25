import { IconArchive } from '@tabler/icons-react'
import { Banner, Button, Card } from '@estiva-app/ui'
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
 * A file hidden **with** a file above it (an issue of an archived project, a
 * page under an archived page) is restored there, not here, so it offers the
 * way to the closest archived one instead (PEEKM-2).
 *
 * The package's Banner in its `warning` tone (Katerina, 5 October), at the
 * top of the messages column: the line, the archive icon and the one action.
 * A Banner is one line, so the resolution is a block of its own under it: a
 * quote, set off by a thin rule in the warning outline (her pick, C) — what
 * the archiver wrote, not more of the line. Both sit on the panel's surface,
 * since the page floats them over the stream as it scrolls and Peek's
 * warning wash is see-through.
 *
 * On an archived file's page it is a **card** instead (Katerina, 7 October),
 * in the composer's place: the file is read-only, so there is nothing to
 * write, and the card says why. Ship's notice, drawn the same way — the
 * package's Card on its `inset` fill and Button, outlined and small — with
 * the resolution a step smaller, in the caption size.
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
  /** `banner`: the strip at the top of a page (a Folder's). `card`: in the composer's place on a read-only file's page. */
  look?: 'banner' | 'card'
}

export function ArchivedNotice({ archive, by, withWhat, onUnarchive, onOpenParent, look = 'banner' }: ArchivedNoticeProps) {
  const when = formatDateLabel(archive.at * 1000)
  const line = archive.with
    ? `Archived with its ${withWhat ?? 'parent'} by ${by} · ${when}`
    : `Archived by ${by} · ${when}`
  const action = archive.with
    ? onOpenParent && { label: `Open ${withWhat ?? 'parent'}`, onClick: onOpenParent }
    : onUnarchive && { label: 'Unarchive', onClick: onUnarchive }
  if (look === 'card') {
    return (
      <Card fill="inset" className="flex items-start gap-3 px-4 py-3">
        <IconArchive size={16} stroke={1.5} className="mt-0.5 shrink-0 text-text-muted" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-body-2-strong text-text-primary">{line}</span>
          {archive.resolution && <p className="whitespace-pre-wrap text-caption text-text-secondary">{archive.resolution}</p>}
        </div>
        {action && (
          <Button variant="outlined" size="small" className="shrink-0" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </Card>
    )
  }
  return (
    <div className="flex flex-col bg-bg-surface">
      <Banner tone="warning" icon={<IconArchive size={16} stroke={1.5} />} {...(action ? { action } : {})}>
        {line}
      </Banner>
      {archive.resolution && (
        <div className="border-b border-border-subtle px-4 py-3">
          <blockquote className="whitespace-pre-wrap border-l-2 border-warning-outline pl-3 text-body-2 text-text-secondary">
            {archive.resolution}
          </blockquote>
        </div>
      )}
    </div>
  )
}
