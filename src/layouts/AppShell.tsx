import { LiveWorkingSet } from '@/components/LiveWorkingSet'
import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { AppShell as Frame } from '@estiva-app/ui'
import { useTopBarSlots } from '@/components/useTopBarSlots'
import { NavRail } from '@/components/NavRail'
import { CommandLauncher } from '@/components/CommandLauncher'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { captureLauncherContext, type LauncherContext } from '@/lib/launcherContext'

interface AppShellProps {
  leftPanel?: ReactNode
  rightPanel?: ReactNode
  threadPanel?: ReactNode
}

/**
 * The frame of every page: the top bar, the side navigation, and the list, main
 * and replies columns, with Cmd/Ctrl+K opening the command launcher.
 *
 * The frame is the package's floating `AppShell` (UIG-14, 9.3): the bar over
 * the top edge, the rail on the ground, the rounded card, and the Signal dot
 * grid on the ground, which the package's preset draws now. What is Peek's:
 * the bar's slots, the rail's entries, the three columns inside the card, the
 * launcher, and the collapsing.
 */
export function AppShell({ leftPanel, rightPanel, threadPanel }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false)
  // The launcher's context is captured ONCE at the invoking keystroke/click
  // (selection > composer > nothing) and frozen for the launcher's lifetime.
  const [launcher, setLauncher] = useState<{ context: LauncherContext } | null>(null)

  const openLauncher = useCallback(() => {
    setLauncher({ context: captureLauncherContext() })
  }, [])

  // Cmd/Ctrl+K opens the launcher from anywhere - browsing or typing in a
  // composer alike (the global listener runs regardless of focus).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setLauncher((v) => (v ? null : { context: captureLauncherContext() }))
      }
    }
    // @estiva-escape: Ctrl+K opens the launcher from anywhere; no part owns a shortcut for the whole app, and opening CommandPalette is Peek's (UIG-8)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const bar = useTopBarSlots({ onMenuToggle: () => setCollapsed((c) => !c), onSearchClick: () => openLauncher() })

  return (
    // The package's frame fills its parent (`h-full`); the page is the window's height.
    <div className="h-screen">
      <Frame
        variant="floating"
        menu={bar.menu}
        search={bar.search}
        identity={bar.identity}
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
              {/* Renders nothing. Holds the live subscriptions for the channels the
                  Desk and inbox are showing — see LiveWorkingSet. Here rather than
                  on a page because the working set belongs to the person, and
                  navigating between pages must not tear it down. */}
              <LiveWorkingSet />
            </div>
          </div>
        }
      >
        {/* The card's columns, side by side. */}
        <div className="flex min-h-0 min-w-0 flex-1">
          {/* Left panel - collapses to 0 width */}
          {leftPanel && (
            <div
              className="shrink-0 border-r border-border-subtle flex flex-col overflow-hidden transition-[width,opacity] duration-300 ease-in-out"
              style={{ width: collapsed ? 0 : 290, opacity: collapsed ? 0 : 1, borderRightWidth: collapsed ? 0 : 1 }}
            >
              <ErrorBoundary label="list panel">{leftPanel}</ErrorBoundary>
            </div>
          )}

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
