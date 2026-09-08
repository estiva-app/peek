import { Routes, Route, Navigate } from 'react-router-dom'
import { DeskPage } from './pages/DeskPage'
import { TopicsPage } from './pages/TopicsPage'
import { PeoplePage } from './pages/PeoplePage'
import { FoldersPage } from '@/pages/FoldersPage'
import { ObjectPage } from './pages/ObjectPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/desk" replace />} />
      <Route path="/desk" element={<DeskPage />} />
      <Route path="/topics" element={<TopicsPage />} />
      {/* One topic, in RFC 0.5 §7's grammar: `/topic/<slug>-<channel-uuid>`.
          Singular for an object, plural for the directory above (PEE-14). */}
      <Route path="/topic/:ref" element={<TopicsPage />} />
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
