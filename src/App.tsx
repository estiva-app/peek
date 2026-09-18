import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { DeskPage } from './pages/DeskPage'
import { TopicsPage } from './pages/TopicsPage'
import { PeoplePage } from './pages/PeoplePage'
import { FoldersPage } from '@/pages/FoldersPage'
import { FilePage } from '@/pages/FilePage'
import { ObjectPage } from './pages/ObjectPage'
import { addressFromRef } from '@/lib/objectUrl'

/**
 * `/topic/:ref` serves two grammars, and the link says which — FOL-19.
 *
 * `<slug>-<uuid>` is one of Peek's own topics (RFC 0.5 §7) and still opens in
 * `TopicsPage`. `<kind>:<pubkey>:<d>` is **any** file, Peek's or another app's,
 * and opens in `FilePage`. They are told apart without fetching anything — an
 * address carries two colons and a slug cannot contain one — which is what let
 * the file route reuse this prefix rather than mint a second one and leave
 * every published topic link resolving through a redirect.
 */
function TopicOrFile() {
  const { ref } = useParams<{ ref: string }>()
  return ref && addressFromRef(ref) ? <FilePage /> : <TopicsPage />
}

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
      {/* One topic, in RFC 0.5 §7's grammar: `/topic/<slug>-<channel-uuid>`.
          Singular for an object, plural for the directory above (PEE-14) — and
          since FOL-19 also `/topic/<address>`, which is any file. */}
      <Route path="/topic/:ref" element={<TopicOrFile />} />
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
