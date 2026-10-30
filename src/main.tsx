import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { DebugProvider } from './lib/debug'
import { PeekDataProvider } from './api'
import { AuthGate } from './auth/AuthGate'
import { EstivaIdCallback } from './auth/EstivaIdCallback'
import { CALLBACK_PATH, storedToken } from './auth/estivaId'
import { RELAY_URL } from './api/relayUrl'
import { warmDeviceCopy } from './nostr/deviceCopy'
import { keepCommentBoxWarm } from '@estiva-app/ui/editor'
import { BOX_EXTENSIONS } from './components/ui/ConversationBox'
import { BoxReference } from './components/ui/BoxReference'
import { watchPagePicture } from './lib/pagePicture'
import { LastSelectionProvider } from './lib/lastSelection'
import { ToastProvider } from './lib/toast'
import { PeekSetup } from './lib/PeekSetup'
/* One TooltipProvider for the whole app (PEEK-ADOPTION.md §2.5): neighbouring
   tooltips share one 300ms wait, so the second and third open at once while
   the group is warm, instead of each button waiting on its own. */
import { ErrorBoundary, TooltipProvider } from '@estiva-app/ui'
import './index.css'
import App from './App.tsx'
import { StartedTopicRefusals } from './components/StartedTopicRefusals'
import { setSocketReader } from './nostr/bridge'
import { relayLog } from './nostr/liveTopics'
import { createAppSocketReader, installSocketReadsDiagnostic } from './nostr/socketRead'

// Reads go over the open connection, one round trip each (OPT-2). Here rather
// than in `@/api`, which tests import, so a test keeps the HTTP path.
setSocketReader(createAppSocketReader(relayLog))
installSocketReadsDiagnostic()
// The copy on the device Desk draws from (PEE-2), read while React renders.
warmDeviceCopy(RELAY_URL, storedToken()?.pubkey)
// The next comment box's editor, built while the page is idle (4ef41d41), with the box's own extensions and chip.
keepCommentBoxWarm({ extensions: BOX_EXTENSIONS, referenceView: BoxReference })
// The saved Desk index.html may have shown: it goes when anything but Desk draws (Desk replaces it itself).
watchPagePicture()

createRoot(document.getElementById('root')!).render(
  /* A page opens in one go, not as a transition (4ef41d41). React Router 7
     wraps each navigation in startTransition by default, and a transition's
     render starts over whenever a relay message lands in a store mid-render:
     Start → a new topic's composer built the page and its editor twice in two
     runs of three, 350–460 ms instead of about 100. Nothing here suspends,
     so a transition bought nothing to show while it waited. */
  <BrowserRouter unstable_useTransitions={false}>
    {/* Root boundary: the last line of defense — providers or a whole page
        crashing degrades to the fallback instead of a white screen. The
        fallback's colour is the page's own (`body`, --bg-base in index.css):
        the package's part takes only its room from here. */}
    <ErrorBoundary label="app" fallbackClassName="h-screen flex flex-col">
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
                        <PeekSetup>
                          <App />
                          <StartedTopicRefusals />
                        </PeekSetup>
                      </TooltipProvider>
                    </ToastProvider>
                  </LastSelectionProvider>
                </AuthGate>
              </PeekDataProvider>
            }
          />
        </Routes>
      </DebugProvider>
    </ErrorBoundary>
  </BrowserRouter>,
)
