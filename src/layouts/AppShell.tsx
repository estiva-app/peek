import { LiveWorkingSet } from '@/components/LiveWorkingSet'
import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { TopBar } from '@/components/TopBar'
import { NavRail } from '@/components/NavRail'
import { CommandLauncher } from '@/components/CommandLauncher'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { captureLauncherContext, type LauncherContext } from '@/lib/launcherContext'

interface AppShellProps {
  leftPanel?: ReactNode
  rightPanel?: ReactNode
  threadPanel?: ReactNode
}

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
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="h-screen overflow-hidden bg-bg-base relative signal-canvas">
      <TopBar onMenuToggle={() => setCollapsed((c) => !c)} onSearchClick={() => openLauncher()} />

      {/* Main area - offset below TopBar */}
      <div className="flex h-full pt-[52px] pb-4 pr-4 transition-[padding] duration-300 ease-in-out"
        style={{ paddingLeft: collapsed ? 16 : 0 }}
      >
        {/* NavRail - collapses to 0 width */}
        <div
          className="shrink-0 overflow-hidden transition-[width,opacity] duration-300 ease-in-out"
          style={{ width: collapsed ? 0 : 64, opacity: collapsed ? 0 : 1 }}
        >
          <NavRail />
          {/* Renders nothing. Holds the live subscriptions for the channels the
              Desk and inbox are showing — see LiveWorkingSet. Here rather than
              on a page because the working set belongs to the person, and
              navigating between pages must not tear it down. */}
          <LiveWorkingSet />
        </div>

        {/* App card */}
        <div className="flex flex-1 min-w-0 bg-bg-surface rounded-2xl overflow-hidden signal:border signal:border-border-subtle signal:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
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
      </div>

      {launcher && (
        <CommandLauncher
          context={launcher.context}
          onClose={() => setLauncher(null)}
        />
      )}
    </div>
  )
}
