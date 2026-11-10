import { IconCircleDashed, IconCircleCheck, IconFolder, IconFile, IconBox, IconListDetails } from '@tabler/icons-react'
import { Avatar } from '@estiva-app/ui'
import { cn } from '@/lib/utils'

export type TopicStateType = 'topic' | 'DM' | 'folder' | 'project' | 'issue' | 'file'
export type TopicStateStatus = 'unresolved' | 'resolved' | 'default'

interface TopicStateProps {
  type: TopicStateType
  status?: TopicStateStatus
  avatarSrc?: string
  className?: string
  /** Override the default text-text-secondary color on the icon (e.g. for selected rows or headers). Resolved icon always stays green. */
  iconClassName?: string
}

/**
 * The small icon before a name that says what it is: a topic, open or resolved,
 * a person's photo, a folder, a Ship project or issue, or a file. (A team, a
 * group's count, a view and a huddle went: nothing draws them since topics,
 * teams and huddles left Convex.)
 */
export function TopicState({
  type,
  status = 'default',
  avatarSrc,
  className,
  iconClassName,
}: TopicStateProps) {
  return (
    <div className={cn('relative shrink-0 flex items-center justify-center w-4 h-4', className)}>
      {type === 'topic' && status === 'resolved' ? (
        <IconCircleCheck size={16} stroke={1.5} className="text-success-default signal:drop-shadow-glow-success" />
      ) : type === 'topic' ? (
        <IconCircleDashed size={16} stroke={1.5} className={cn('text-text-secondary', iconClassName)} />
      ) : type === 'DM' ? (
        <Avatar size={16} src={avatarSrc} />
      ) : /*
           A Folder is a folder. It had no glyph of its own, so the Folders
           list fell through to the `topic` default and drew every row the
           dashed circle that means "an unresolved topic" — on eighty-one
           rows, none of which is a topic (Katerina, 2026-09-11).
         */
        type === 'folder' ? (
        <IconFolder size={16} stroke={1.5} className={cn('text-text-secondary', iconClassName)} />
      ) : /*
           A Ship project and a Ship issue wear Ship's own glyphs, the box and
           the list its sidebar and its "Mentioned in" lines give them, in
           every place Peek draws one (Katerina, 7 October). `fileGlyph` says
           which a file is.
         */
        type === 'project' ? (
        <IconBox size={16} stroke={1.5} className={cn('text-text-secondary', iconClassName)} />
      ) : type === 'issue' ? (
        <IconListDetails size={16} stroke={1.5} className={cn('text-text-secondary', iconClassName)} />
      ) : /*
           A file another app owns — a Ship project or issue in the file tree
           (FOL-19). Not the dashed circle: that glyph means "an unresolved
           topic", and a Ship issue is neither. Peek's own bare file is a topic
           and keeps the topic glyph; this is for any other app's file.
         */
        type === 'file' ? (
        <IconFile size={16} stroke={1.5} className={cn('text-text-secondary', iconClassName)} />
      ) : null}
    </div>
  )
}
