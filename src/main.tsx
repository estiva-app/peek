import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { ThemeProvider } from './lib/theme'
import { DebugProvider } from './lib/debug'
import { PeekDataProvider } from './api'
import { AuthGate } from './auth/AuthGate'
import { EstivaIdCallback } from './auth/EstivaIdCallback'
import { CALLBACK_PATH } from './auth/estivaId'
import { LastSelectionProvider } from './lib/lastSelection'
import { ToastProvider } from './lib/toast'
/* One TooltipProvider for the whole app (PEEK-ADOPTION.md §2.5): neighbouring
   tooltips share one 300ms wait, so the second and third open at once while
   the group is warm, instead of each button waiting on its own. */
import { ErrorBoundary, TooltipProvider } from '@estiva-app/ui'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    {/* Root boundary: the last line of defense — providers or a whole page
        crashing degrades to the fallback instead of a white screen. The
        fallback's colour is the page's own (`body`, --bg-base in index.css):
        the package's part takes only its room from here. */}
    <ErrorBoundary label="app" fallbackClassName="h-screen flex flex-col">
      <ThemeProvider>
        <DebugProvider>
          <Routes>
            {/* Outside PeekDataProvider and AuthGate on purpose (PEEK-104). You
                land here holding a code and nothing else — the gate would bounce
                you to sign-in mid-exchange, and the exchange is with Estiva ID,
                so it needs no Convex client. */}
            <Route path={CALLBACK_PATH} element={<EstivaIdCallback />} />
            <Route
              path="*"
              element={
                <PeekDataProvider>
                  <AuthGate>
                    <LastSelectionProvider>
                      <ToastProvider>
                        <TooltipProvider>
                          <App />
                        </TooltipProvider>
                        <Analytics />
                      </ToastProvider>
                    </LastSelectionProvider>
                  </AuthGate>
                </PeekDataProvider>
              }
            />
          </Routes>
        </DebugProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </BrowserRouter>,
)
