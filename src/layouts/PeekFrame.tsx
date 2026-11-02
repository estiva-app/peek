import { useState, useCallback, type ReactNode } from 'react'
import { AppShell as Frame, ErrorBoundary, useSidebarFold } from '@estiva-app/ui'
import { CALLBACK_PATH } from '@/auth/estivaId'
import { useTopBarSlots } from '@/components/useTopBarSlots'
import { NavRail } from '@/components/NavRail'
import { CommandLauncher } from '@/components/CommandLauncher'
import { captureLauncherContext, type LauncherContext } from '@/lib/launcherContext'
import { RailClosed } from './railClosed'

interface PeekFrameProps {
  /** The page's list column: the package's `ListColumn`, which closes with the rail (`useRailClosed`). */
  leftPanel?: ReactNode
  rightPanel?: ReactNode
  /**
   * The column beside, 384px: another app's read-only file's thread or Overview. Peek's own conversations draw their
   * open thread and Overview in the kit's ConversationLayout, inside `rightPanel` (B1).
   */
  threadPanel?: ReactNode
  /**
   * The package frame's banner, at the top of the content area: what a page
   * says about the whole of what it shows — an archived file's notice (FOL-46).
   */
  banner?: ReactNode
}

/**
 * Whether the page open now is a file, which a link may have opened: a topic, a message, a Folder, a person — not
 * Desk, nor a list. A file opened from a link unfolds a folded sidebar (Katerina, 30 October), as in Ship and Leaf.
 */
function isFile(): boolean {
  const parts = window.location.pathname.split('/').filter(Boolean)
  if (parts[0] === 'app') return parts.length >= 3
  return parts.length >= 2 && window.location.pathname !== CALLBACK_PATH
}

/**
 * The frame of every page: the top bar, the side navigation, and the list, main
 * and replies columns, with Cmd/Ctrl+K opening the command launcher.
 *
 * The frame is the package's floating `AppShell` (UIG-14, 9.3): the bar over
 * the top edge, the rail on the ground, the rounded card, and the Signal dot
 * grid on the ground, which the package's preset draws now — and, since
 * 0.60.0, the search field and Ctrl+K. What is Peek's: the bar's slots, the
 * rail's entries, the three columns inside the card, and the launcher. The
 * fold is the package's since 0.95.0: its button, its motion, and a folded
 * sidebar kept folded on this browser (Katerina, 31 October: one fold in every
 * app). Called AppShell until 8 October, when the package's own name became
 * the gate's to refuse (Katerina, UIG-49).
 *
 * The list column is the page's own: the package's `ListColumn` (UIG-14, N9),
 * with its own error boundary. The frame only tells it when the rail is closed.
 */
export function PeekFrame({ leftPanel, rightPanel, threadPanel, banner }: PeekFrameProps) {
  const [navOpen, setNavOpen] = useSidebarFold({ storageKey: 'peek.sidebarFolded', isFile })
  // The launcher's context is captured ONCE at the invoking keystroke/click
  // (selection > composer > nothing) and frozen for the launcher's lifetime.
  const [launcher, setLauncher] = useState<{ context: LauncherContext } | null>(null)

  // The bar's search field and Cmd/Ctrl+K, from anywhere — browsing or typing in
  // a composer alike — both land here. A second Ctrl+K closes it. A click on the
  // field leaves focus in the composer, so the context sees it (0.60.1).
  const toggleLauncher = useCallback(() => {
    setLauncher((v) => (v ? null : { context: captureLauncherContext() }))
  }, [])

  const bar = useTopBarSlots()

  return (
    // The package's frame fills its parent (`h-full`); the page is the window's height.
    <div className="h-screen">
      <Frame
        variant="floating"
        navOpen={navOpen}
        onNavOpenChange={setNavOpen}
        onSearch={toggleLauncher}
        searchPlaceholder="Search Peek..."
        identity={bar.identity}
        banner={banner}
        nav={<NavRail />}
      >
        {/* The card's columns, side by side. */}
        <div className="flex min-h-0 min-w-0 flex-1">
          {/*
            The page's list column draws itself: the package's `ListColumn`
            with its 290px, its line, its own error boundary, and the
            narrowing and fade that follow the frame's fold. Only whether the
            rail is closed comes from here.
          */}
          <RailClosed value={!navOpen}>{leftPanel}</RailClosed>

          {/* Right panel (conversation area) */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <ErrorBoundary label="conversation">{rightPanel}</ErrorBoundary>
          </div>

          {/* Thread panel: 384px, the right column in every app (Katerina, 31 October), as the kit's layout draws its own. */}
          {threadPanel && (
            <div className="shrink-0 w-[384px] border-l border-border-subtle flex flex-col overflow-hidden">
              <ErrorBoundary label="thread panel">{threadPanel}</ErrorBoundary>
            </div>
          )}
        </div>
      </Frame>
      {bar.panel}

      {launcher && (
        <CommandLauncher
          context={launcher.context}
          onClose={() => setLauncher(null)}
        />
      )}
    </div>
  )
}
