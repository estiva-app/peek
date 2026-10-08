import {
  IconCircleDashed,
  IconCircleCheck,
  IconUsers,
  IconBrackets,
  IconLock, IconFolder, IconFile, IconBox, IconListDetails,} from '@tabler/icons-react'
import { Avatar } from '@estiva-app/ui'
import { cn } from '@/lib/utils'

export type TopicStateType = 'topic' | 'DM' | 'team' | 'group' | 'view' | 'huddle' | 'folder' | 'project' | 'issue' | 'file'
export type TopicStateStatus = 'unresolved' | 'resolved' | 'default'

interface TopicStateProps {
  type: TopicStateType
  status?: TopicStateStatus
  avatarSrc?: string
  memberCount?: number
  className?: string
  /** Override the default text-text-secondary color on the icon (e.g. for selected rows or headers). Resolved icon always stays green. */
  iconClassName?: string
}

/**
 * The small icon before a name that says what it is: a topic, open or resolved,
 * a person's photo, a huddle, a folder, a Ship project or issue, or a file.
 */
export function TopicState({
  type,
  status = 'default',
  avatarSrc,
  memberCount,
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
      ) : type === 'team' ? (
        <IconUsers size={16} stroke={1.5} className={cn('text-text-secondary', iconClassName)} />
      ) : type === 'group' ? (
        <div className="flex items-center justify-center bg-bg-inset rounded-sm px-[2px] min-w-[16px] h-[16px]">
          {/* @estiva-escape(no-copied-look): A4 (Katerina, 24 September: record only): a group's count in the chip text style, which Chip and MetaText also use */}
          <span className={cn('text-chip text-text-secondary leading-none signal:font-mono signal:text-small signal:tabular-nums', iconClassName)}>
            {memberCount ?? 0}
          </span>
        </div>
      ) : type === 'view' ? (
        <IconBrackets size={16} stroke={1.5} className={cn('text-text-secondary', iconClassName)} />
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
      ) : type === 'huddle' ? (
        <IconLock size={16} stroke={1.5} className={cn('text-text-secondary', iconClassName)} />
      ) : null}
    </div>
  )
}
