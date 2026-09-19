import { TopBar as TopBarShell } from '@estiva-app/ui'
import { useTopBarSlots, type TopBarSlotsProps } from './useTopBarSlots'

/**
 * The bar is the shared floating TopBar (2026-09-02); what rides in its
 * slots — the launcher affordance, the identity — is Peek's, unchanged.
 *
 * The app's frame draws the bar itself now (the package's `AppShell`, UIG-14
 * 9.3) from `useTopBarSlots`; this draws the same slots on their own, for the
 * bar's story and its viewer-avatar test.
 */
export function TopBar(props: TopBarSlotsProps) {
  const slots = useTopBarSlots(props)
  return (
    <>
      <TopBarShell variant="floating" menu={slots.menu} search={slots.search} right={slots.identity} />
      {slots.panel}
    </>
  )
}
