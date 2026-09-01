import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { EnterHint, MenuItem, SectionLabel } from '@estiva-app/ui'
import { TopicState } from './TopicState'
import { cn } from '@/lib/utils'
import { useIsTopicResolved } from '@/api'
import { type Topic } from '@/api'
import { type AppFile, type DocumentFile, type AppCategory, APP_CATEGORIES } from '@/api'
import {
  IconBrandGithub,
  IconFile,
  IconFileTypePdf,
  IconPhoto,
  IconTable,
  IconPresentation,
  IconChevronRight,
  IconArrowLeft,
} from '@tabler/icons-react'
import figmaIcon from '@/assets/figma icon.svg'
import linearIcon from '@/assets/linear icon.svg'

// ─── Icons ───

// Apps with SVG brand icons (already include background)
const APP_SVG_ICONS: Record<string, string> = {
  figma: figmaIcon,
  linear: linearIcon,
}

// Apps that use Tabler icons (need bg-bg-inset container)
const APP_TABLER_ICONS: Record<string, React.FC<{ size: number; stroke: number; className?: string }>> = {
  github: IconBrandGithub,
}

const DOC_ICONS: Record<string, React.FC<{ size: number; stroke: number; className?: string }>> = {
  pdf: IconFileTypePdf,
  image: IconPhoto,
  spreadsheet: IconTable,
  presentation: IconPresentation,
  generic: IconFile,
}

function AppIcon({ app, size = 32 }: { app: string; size?: number }) {
  const svgSrc = APP_SVG_ICONS[app]
  if (svgSrc) {
    return <img src={svgSrc} width={size} height={size} alt={app} className="rounded-sm" />
  }
  const TablerIcon = APP_TABLER_ICONS[app] ?? IconFile
  return (
    <span className="flex items-center justify-center size-8 shrink-0 rounded-sm bg-bg-inset text-text-secondary">
      <TablerIcon size={16} stroke={1.5} />
    </span>
  )
}

// ─── Types ───

export type FilesMenuItem =
  | { kind: 'topic'; data: Topic }
  | { kind: 'app'; data: AppFile }
  | { kind: 'document'; data: DocumentFile }

export type FilesMenuRef = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface FilesMenuProps {
  items: FilesMenuItem[]
  query: string
  onSelect: (item: FilesMenuItem) => void
}

// ─── Nav entry types for building the flat navigable list ───

type NavEntry =
  | { type: 'header'; label: string }
  | { type: 'item'; item: FilesMenuItem; navIndex: number }
  | { type: 'app-nav'; category: AppCategory; navIndex: number }

function buildLevel1(items: FilesMenuItem[]): { entries: NavEntry[]; navCount: number } {
  const topics = items.filter((i) => i.kind === 'topic')
  const docs = items.filter((i) => i.kind === 'document')
  const entries: NavEntry[] = []
  let idx = 0

  // No app items (the real app: files aren't implemented) → no Apps section;
  // never offer a drill-in that only leads to empty lists.
  if (items.some((i) => i.kind === 'app')) {
    entries.push({ type: 'header', label: 'Apps' })
    for (const cat of APP_CATEGORIES) {
      entries.push({ type: 'app-nav', category: cat, navIndex: idx++ })
    }
  }

  if (topics.length > 0) {
    entries.push({ type: 'header', label: 'Topics' })
    for (const item of topics) {
      entries.push({ type: 'item', item, navIndex: idx++ })
    }
  }

  if (docs.length > 0) {
    entries.push({ type: 'header', label: 'Documents' })
    for (const item of docs) {
      entries.push({ type: 'item', item, navIndex: idx++ })
    }
  }

  return { entries, navCount: idx }
}

function buildLevel2(items: FilesMenuItem[], app: string): { entries: NavEntry[]; navCount: number } {
  const appItems = items.filter((i) => i.kind === 'app' && i.data.app === app)
  const entries: NavEntry[] = []
  let idx = 0
  for (const item of appItems) {
    entries.push({ type: 'item', item, navIndex: idx++ })
  }
  return { entries, navCount: idx }
}

function buildFiltered(items: FilesMenuItem[], query: string): { entries: NavEntry[]; navCount: number } {
  const q = query.toLowerCase()
  const filtered = items.filter((i) => {
    if (i.kind === 'topic') return i.data.title.toLowerCase().includes(q)
    if (i.kind === 'app') return i.data.title.toLowerCase().includes(q) || i.data.subtitle?.toLowerCase().includes(q) || i.data.appLabel.toLowerCase().includes(q)
    return i.data.title.toLowerCase().includes(q)
  })

  const topics = filtered.filter((i) => i.kind === 'topic')
  const apps = filtered.filter((i) => i.kind === 'app')
  const docs = filtered.filter((i) => i.kind === 'document')
  const entries: NavEntry[] = []
  let idx = 0

  if (apps.length > 0) {
    entries.push({ type: 'header', label: 'Apps' })
    for (const item of apps) entries.push({ type: 'item', item, navIndex: idx++ })
  }
  if (topics.length > 0) {
    entries.push({ type: 'header', label: 'Topics' })
    for (const item of topics) entries.push({ type: 'item', item, navIndex: idx++ })
  }
  if (docs.length > 0) {
    entries.push({ type: 'header', label: 'Documents' })
    for (const item of docs) entries.push({ type: 'item', item, navIndex: idx++ })
  }
  return { entries, navCount: idx }
}

// ─── Component ───

export const FilesMenu = forwardRef<FilesMenuRef, FilesMenuProps>(
  ({ items, query, onSelect }, ref) => {
    const [highlight, setHighlight] = useState(0)
    const [drilledApp, setDrilledApp] = useState<string | null>(null)
    const isTopicResolved = useIsTopicResolved()

    const isSearching = query.length > 0
    const isLevel2 = drilledApp !== null && !isSearching

    const { entries, navCount } = isSearching
      ? buildFiltered(items, query)
      : isLevel2
        ? buildLevel2(items, drilledApp)
        : buildLevel1(items)

    useEffect(() => setHighlight(0), [query, drilledApp])

    const getNavAt = (idx: number) => entries.find((e) => e.type !== 'header' && ('navIndex' in e) && e.navIndex === idx) as
      | (NavEntry & { type: 'item' | 'app-nav' })
      | undefined

    const drillIn = useCallback((app: string) => {
      setDrilledApp(app)
      setHighlight(0)
    }, [])

    const drillOut = useCallback(() => {
      setDrilledApp(null)
      setHighlight(0)
    }, [])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowDown') {
          setHighlight((h) => Math.min(h + 1, navCount - 1))
          return true
        }
        if (event.key === 'ArrowUp') {
          setHighlight((h) => Math.max(h - 1, 0))
          return true
        }
        if (event.key === 'Enter' || event.key === 'ArrowRight') {
          const entry = getNavAt(highlight)
          if (!entry) return false
          if (entry.type === 'app-nav') {
            drillIn(entry.category.app)
            return true
          }
          if (entry.type === 'item' && event.key === 'Enter') {
            onSelect(entry.item)
            return true
          }
          return false
        }
        if (event.key === 'ArrowLeft' && isLevel2) {
          drillOut()
          return true
        }
        if (event.key === 'Backspace' && isLevel2 && query === '') {
          drillOut()
          return true
        }
        return false
      },
    }))

    const scrollRef = useCallback((el: HTMLElement | null) => {
      el?.scrollIntoView({ block: 'nearest' })
    }, [])

    if (navCount === 0) return null

    const appLabel = isLevel2
      ? APP_CATEGORIES.find((c) => c.app === drilledApp)?.label ?? ''
      : ''

    return (
      <div className="w-[658px] max-h-[360px] overflow-y-auto bg-bg-elevated border border-border-default rounded-lg shadow-lg">
        <div className="p-2">
          {/* Level 2 back header */}
          {isLevel2 && (
            <div
              className="flex items-center gap-2 h-8 px-3 py-1 rounded-lg cursor-pointer text-text-secondary hover:text-text-primary transition-colors"
              onMouseDown={(e) => {
                e.preventDefault()
                drillOut()
              }}
            >
              <IconArrowLeft size={14} stroke={1.5} />
              <span className="text-[12px] font-medium leading-none">{appLabel}</span>
            </div>
          )}

          {entries.map((entry, i) => {
            if (entry.type === 'header') {
              return (
                <div key={`h-${entry.label}`} className={cn('flex items-center h-8 px-2', i > 0 && 'mt-1')}>
                  <SectionLabel className="text-text-secondary">{entry.label}</SectionLabel>
                </div>
              )
            }

            const isHighlighted = entry.navIndex === highlight

            if (entry.type === 'app-nav') {
              const cat = entry.category
              return (
                <MenuItem
                  key={`nav-${cat.app}`}
                  size="tall"
                  ref={isHighlighted ? scrollRef : undefined}
                  leading={<AppIcon app={cat.app} />}
                  label={cat.label}
                  description={cat.description}
                  selected={isHighlighted}
                  trailing={
                    isHighlighted ? (
                      <EnterHint />
                    ) : (
                      <IconChevronRight size={14} stroke={1.5} className="text-text-muted" />
                    )
                  }
                  onMouseEnter={() => setHighlight(entry.navIndex)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    drillIn(cat.app)
                  }}
                />
              )
            }

            // Regular item
            const { item } = entry
            const leading =
              item.kind === 'topic' ? (
                <span className="flex items-center justify-center size-8 shrink-0 rounded-sm bg-bg-inset">
                  <TopicState type="topic" status={isTopicResolved(item.data.id) ? 'resolved' : 'unresolved'} />
                </span>
              ) : item.kind === 'app' ? (
                <AppIcon app={item.data.app} />
              ) : (
                (() => {
                  const Icon = DOC_ICONS[item.data.docType] ?? IconFile
                  return (
                    <span className="flex items-center justify-center size-8 shrink-0 rounded-sm bg-bg-inset text-text-secondary">
                      <Icon size={16} stroke={1.5} />
                    </span>
                  )
                })()
              )
            return (
              <MenuItem
                key={`${item.kind}-${item.data.id}`}
                size="tall"
                ref={isHighlighted ? scrollRef : undefined}
                leading={leading}
                label={item.data.title}
                description={item.kind !== 'topic' ? item.data.subtitle : undefined}
                selected={isHighlighted}
                trailing={isHighlighted ? <EnterHint /> : undefined}
                onMouseEnter={() => setHighlight(entry.navIndex)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelect(item)
                }}
              />
            )
          })}
        </div>
      </div>
    )
  }
)
FilesMenu.displayName = 'FilesMenu'
