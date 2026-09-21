import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { DeskPage } from './pages/DeskPage'
import { TopicsPage } from './pages/TopicsPage'
import { PeoplePage } from './pages/PeoplePage'
import { FoldersPage } from '@/pages/FoldersPage'
import { FilePage } from '@/pages/FilePage'
import { ObjectPage } from './pages/ObjectPage'
import { useRouteWords } from '@/api'

/**
 * A page of Peek's own that moved under `/app/` (FOL-39): the old path sends
 * on to the new one, search and all, so a bookmark or a browser history entry
 * still lands where it did.
 */
function MovedUnderApp() {
  const { pathname, search } = useLocation()
  return <Navigate to={`/app${pathname}${search}`} replace />
}

/**
 * Peek's pages by address — RFC 0.5 §7.7 (FOL-39).
 *
 * **The root belongs to files.** `/<word>/<slug>-<d>` opens the file of any
 * shape a manifest on the relay declares — `project` and `issue` from Ship's,
 * `topic` from Peek's — and the word is read at runtime, never listed here:
 * the one file route is `/:word/:ref`, and `FilePage` asks the manifests what
 * the word means. The path names the file and the host names the perspective,
 * so `peek.estiva.app/project/<d>` and `ship.estiva.app/project/<d>` are one
 * file. Everything of Peek's that is not a file lives under `/app/`, with the
 * old paths redirecting; what stays at the root is what other apps' links and
 * Peek's own manifest already name — `/topics`, `/o/`, `/message/`, and
 * `/topic-old/` for as long as the Convex topics last.
 */
function App() {
  // Asked once, here, so a link is the short form from the first render after
  // the manifests answer — and the tree draws again when they do.
  useRouteWords()
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app/desk" replace />} />
      <Route path="/app" element={<Navigate to="/app/desk" replace />} />
      <Route path="/app/desk" element={<DeskPage />} />
      {/* Navigation by Folder (RFC 0.4 §4) — added beside the topic routes,
          not over them. §11.1's topic→file migration is a separate change. */}
      <Route path="/app/folders" element={<FoldersPage />} />
      <Route path="/app/folders/:id" element={<FoldersPage />} />
      <Route path="/app/people" element={<PeoplePage />} />
      <Route path="/app/people/:id" element={<PeoplePage />} />
      {/* Where those pages were until FOL-39. */}
      <Route path="/desk" element={<MovedUnderApp />} />
      <Route path="/folders" element={<MovedUnderApp />} />
      <Route path="/folders/:id" element={<MovedUnderApp />} />
      <Route path="/people" element={<MovedUnderApp />} />
      <Route path="/people/:id" element={<MovedUnderApp />} />
      <Route path="/topics" element={<TopicsPage />} />
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
      {/* One file, in RFC 0.5 §7's grammar: `/<word>/<slug>-<d>` for any word
          a manifest declares (FOL-39), and `/topic/<kind>:<pubkey>:<d>` for
          any file at all (FOL-19, FOL-37). Singular for an object, plural for
          the directory above (PEE-14). The static routes above rank ahead of
          this one, so a word of Peek's own never reaches it. A link that still
          names a Convex topic's channel uuid here is sent on to `/topic-old/`
          by `FilePage`. */}
      <Route path="/:word/:ref" element={<FilePage />} />
    </Routes>
  )
}

export default App
