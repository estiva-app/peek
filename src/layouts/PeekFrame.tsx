import { useState, useCallback, type ReactNode } from 'react'
import { AppShell as Frame, ErrorBoundary } from '@estiva-app/ui'
import { useTopBarSlots } from '@/components/useTopBarSlots'
import { NavRail } from '@/components/NavRail'
import { CommandLauncher } from '@/components/CommandLauncher'
import { captureLauncherContext, type LauncherContext } from '@/lib/launcherContext'
import { RailClosed } from './railClosed'

interface PeekFrameProps {
  /** The page's list column: the package's `ListColumn`, which closes with the rail (`useRailClosed`). */
  leftPanel?: ReactNode
  rightPanel?: ReactNode
  threadPanel?: ReactNode
  /**
   * The package frame's banner, at the top of the content area: what a page
   * says about the whole of what it shows — an archived file's notice (FOL-46).
   */
  banner?: ReactNode
}

/**
 * The frame of every page: the top bar, the side navigation, and the list, main
 * and replies columns, with Cmd/Ctrl+K opening the command launcher.
 *
 * The frame is the package's floating `AppShell` (UIG-14, 9.3): the bar over
 * the top edge, the rail on the ground, the rounded card, and the Signal dot
 * grid on the ground, which the package's preset draws now — and, since
 * 0.60.0, the search field and Ctrl+K. What is Peek's: the bar's slots, the
 * rail's entries, the three columns inside the card, the launcher, and the
 * collapsing. Called AppShell until 8 October, when the package's own name
 * became the gate's to refuse (Katerina, UIG-49).
 *
 * The list column is the page's own: the package's `ListColumn` (UIG-14, N9),
 * with its own error boundary. The frame only tells it when the rail is closed.
 */
export function PeekFrame({ leftPanel, rightPanel, threadPanel, banner }: PeekFrameProps) {
  const [collapsed, setCollapsed] = useState(false)
  // The launcher's context is captured ONCE at the invoking keystroke/click
  // (selection > composer > nothing) and frozen for the launcher's lifetime.
  const [launcher, setLauncher] = useState<{ context: LauncherContext } | null>(null)

  // The bar's search field and Cmd/Ctrl+K, from anywhere — browsing or typing in
  // a composer alike — both land here. A second Ctrl+K closes it. A click on the
  // field leaves focus in the composer, so the context sees it (0.60.1).
  const toggleLauncher = useCallback(() => {
    setLauncher((v) => (v ? null : { context: captureLauncherContext() }))
  }, [])

  const bar = useTopBarSlots({ onMenuToggle: () => setCollapsed((c) => !c) })

  return (
    // The package's frame fills its parent (`h-full`); the page is the window's height.
    <div className="h-screen">
      <Frame
        variant="floating"
        menu={bar.menu}
        onSearch={toggleLauncher}
        searchPlaceholder="Search Peek..."
        identity={bar.identity}
        banner={banner}
        nav={
          /*
            The rail collapses, which is Peek's (the package's page says so).
            The column narrows from 64px to 16px and the rail fades: the 16px
            is the gap the card keeps from the window's edge when the rail is
            gone, which the row's left padding used to give it.
          */
          <div
            className="shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out"
            style={{ width: collapsed ? 16 : 64 }}
          >
            <div className="transition-opacity duration-300 ease-in-out" style={{ opacity: collapsed ? 0 : 1 }}>
              <NavRail />
            </div>
          </div>
        }
      >
        {/* The card's columns, side by side. */}
        <div className="flex min-h-0 min-w-0 flex-1">
          {/*
            The page's list column draws itself: the package's `ListColumn`
            with its 290px, its line, its own error boundary, and the
            narrowing and fade that follow the menu button. Only whether the
            rail is closed comes from here.
          */}
          <RailClosed value={collapsed}>{leftPanel}</RailClosed>

          {/* Right panel (conversation area) */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <ErrorBoundary label="conversation">{rightPanel}</ErrorBoundary>
          </div>

          {/* Thread panel */}
          {threadPanel && (
            <div className="shrink-0 w-[380px] border-l border-border-subtle flex flex-col overflow-hidden">
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
