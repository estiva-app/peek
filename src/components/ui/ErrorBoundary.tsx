import { Component, type ReactNode } from 'react'
import { IconAlertTriangle } from '@tabler/icons-react'
import { Button } from './Button'
import { EmptyState } from './EmptyState'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Where the boundary sits ("left panel", "conversation", …) — makes the
   *  console line and the fallback copy specific. */
  label?: string
  /** Fills the slot it guards; panels center the fallback vertically. */
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
    return (
      <div className={this.props.fallbackClassName ?? 'flex-1 h-full flex items-center justify-center'}>
        <div className="flex flex-col items-center gap-4 px-6 py-8">
          <EmptyState
            icon={<IconAlertTriangle size={20} stroke={1.5} />}
            message={`Something went wrong${this.props.label ? ` in the ${this.props.label}` : ''}. Your data is safe — try again.`}
          />
          <Button variant="muted" size="small" onClick={() => this.setState({ hasError: false })}>
            Try again
          </Button>
        </div>
      </div>
    )
  }
}
