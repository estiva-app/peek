import { CollapsibleSection } from '@estiva-app/ui'
import { Chip } from './ui/Chip'
import { ScreenerItem } from './ScreenerItem'
import type { ScreenerItem as ScreenerItemData } from '@/api'

interface ScreenerSectionProps {
  items: ScreenerItemData[]
  onOpen?: (id: string) => void
  onLater?: (id: string, untilMs: number) => void
  onDismiss?: (id: string) => void
  className?: string
}

/**
 * The Screener on the Desk: a folding list of incoming topics and messages,
 * each with Open, Later and Dismiss, and a count beside the title.
 */
export function ScreenerSection({ items, onOpen, onLater, onDismiss, className }: ScreenerSectionProps) {
  if (items.length === 0) return null

  return (
    /* The package's CollapsibleSection since 0.12.2 (§4.8, D42): the last of
       Peek's five hand-drawn folding headers. It needed `trailing` for the
       count chip on the right, which the package gained at 0.12.2 (B23). */
    <CollapsibleSection
      title="Screener"
      storageKey="peek.desk.screener"
      trailing={<Chip type="brand" label={String(items.length)} />}
      className={className}
      contentClassName="gap-0.5 mt-1"
    >
      {items.map((item) => (
        <ScreenerItem
          key={item.id}
          item={item}
          onOpen={onOpen}
          onLater={onLater}
          onDismiss={onDismiss}
        />
      ))}
    </CollapsibleSection>
  )
}
