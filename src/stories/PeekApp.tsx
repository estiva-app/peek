import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@/lib/theme'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import App from '@/App'

/**
 * The whole Peek app, mounted for Storybook — the exact provider stack from
 * `main.tsx` (minus Vercel Analytics), with routing driven by `MemoryRouter`
 * so a story can deep-link to any page. Real navigation, toasts, and the seam
 * run, so full journeys (e.g. promoting a DM to a topic) work end to end.
 */
export function PeekApp({ route = '/app/desk' }: { route?: string }) {
  return (
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <DebugProvider>
          <PeekDataProvider>
            <LastSelectionProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </LastSelectionProvider>
          </PeekDataProvider>
        </DebugProvider>
      </ThemeProvider>
    </MemoryRouter>
  )
}
