import { Routes, Route, Navigate } from 'react-router-dom'
import { DeskPage } from './pages/DeskPage'
import { TopicsPage } from './pages/TopicsPage'
import { PeoplePage } from './pages/PeoplePage'
import { FoldersPage } from '@/pages/FoldersPage'
import { FilePage } from '@/pages/FilePage'
import { ObjectPage } from './pages/ObjectPage'

/**
 * Peek's pages by address: the Desk, Topics, one topic or file, an object or a
 * message, Folders and People — and the old topic addresses still work.
 */
function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/desk" replace />} />
      <Route path="/desk" element={<DeskPage />} />
      <Route path="/topics" element={<TopicsPage />} />
      {/* One file, in RFC 0.5 §7's grammar (FOL-37): `/topic/<slug>-<d>` is a
          topic in a Folder — a bare file — and `/topic/<kind>:<pubkey>:<d>` is
          any file (FOL-19). Singular for an object, plural for the directory
          above (PEE-14). A link that still names a Convex topic's channel uuid
          here is sent on to `/topic-old/` by `FilePage`. */}
      <Route path="/topic/:ref" element={<FilePage />} />
      {/* One Convex channel topic: `/topic-old/<slug>-<channel-uuid>` — the
          same grammar at the prefix FOL-37 moved the retiring topics to, so the
          short form is free for what is being built. */}
      <Route path="/topic-old/:ref" element={<TopicsPage />} />
      {/* Legacy. The id here is Peek-private, so these links resolve nowhere
          else — but they are already in the wild, and in every browser history
          that has ever opened a topic. TopicsPage replaces the URL with the
          canonical one once the topic resolves. */}
      <Route path="/topics/:id" element={<TopicsPage />} />
      {/* What the NIP-89 manifest advertises: any consumer holding one of
          Peek's objects can open it here, whether it is addressed by naddr or
          named by nevent (PRO-11). */}
      <Route path="/o/:ref" element={<ObjectPage />} />
      {/* One message, RFC 0.5 §7.6's `<id>` identity — a kind:9 has no `d`, so
          its event id is the whole of it. Resolved the same way `/o/` is: find
          the event, open the topic that holds it (PEE-17). */}
      <Route path="/message/:ref" element={<ObjectPage />} />
      {/* Navigation by Folder (RFC 0.4 §4) — added beside the topic routes,
          not over them. §11.1's topic→file migration is a separate change. */}
      <Route path="/folders" element={<FoldersPage />} />
      <Route path="/folders/:id" element={<FoldersPage />} />
      <Route path="/people" element={<PeoplePage />} />
      <Route path="/people/:id" element={<PeoplePage />} />
    </Routes>
  )
}

export default App
