import { Component, type ReactNode } from 'react'
import { IconAlertTriangle } from '@tabler/icons-react'
import { EmptyState } from './EmptyState'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Where the boundary sits ("left panel", "conversation", …) — makes the
   *  console line and the fallback copy specific. */
  label?: string
  /** The whole screen the fallback fills, where no flex column holds it (the app's own boundary). */
  fallbackClassName?: string
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * Catches a part of the page that crashes and shows a quiet "Something went
 * wrong" line with a Try again button, so the rest of the app keeps working.
 *
 * Production hardening (Phase 5): a crashing subtree degrades to a quiet
 * inline fallback instead of white-screening the app. One boundary wraps
 * each AppShell slot, so every page is covered at the panel level; "Try
 * again" re-mounts just that subtree.
 * @registry reusable: stays in Peek (Katerina, 18 September); its message becomes estiva-ui's EmptyState with a button
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error(`[peek] ${this.props.label ?? 'ui'} crashed:`, error, info.componentStack ?? '')
  }

  render() {
    if (!this.state.hasError) return this.props.children
    // The package's EmptyState with its one action (Katerina, 2026-09-18): in a
    // panel's flex column it takes the room and centres itself, with no box.
    const message = (
      <EmptyState
        icon={<IconAlertTriangle size={16} stroke={1.5} />}
        message={`Something went wrong${this.props.label ? ` in the ${this.props.label}` : ''}. Your data is safe — try again.`}
        action={{ label: 'Try again', onClick: () => this.setState({ hasError: false }) }}
      />
    )
    // The whole app's boundary has no column around it, and names its own screen.
    return this.props.fallbackClassName ? <div className={this.props.fallbackClassName}>{message}</div> : message
  }
}
