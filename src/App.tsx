import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { DeskPage } from './pages/DeskPage'
import { LegacyTopicRedirect } from './pages/LegacyTopicRedirect'
import { PeoplePage } from './pages/PeoplePage'
import { FoldersPage } from '@/pages/FoldersPage'
import { TopicsPage } from '@/pages/TopicsPage'
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
 * A team's page before its links said teams: `/app/folders/…`, and `/folders/…`
 * before FOL-39. Those links sit in messages and descriptions on the relay, so
 * they are kept for good and land on the same view at `/app/teams/…` in one hop.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-teams-link-says-teams-and-an-old-folder-link-still-opens-it.md
 */
function TeamMoved() {
  const { pathname, search, hash } = useLocation()
  const rest = pathname.replace(/^(\/app)?\/folders/, '')
  return <Navigate to={`/app/teams${rest}${search}${hash}`} replace />
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
 * Peek's own manifest already name — `/o/` and `/message/` — and `/topics`
 * and `/topic-old/`, which only redirect since FOL-26.
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
      {/* Your topics with their files (TOP-4); what was Topics until then is Folders, below. */}
      <Route path="/app/topics" element={<TopicsPage />} />
      <Route path="/app/topics/explore" element={<TopicsPage explore />} />
      {/* Navigation by Folder (RFC 0.4 §4) — added beside the topic routes,
          not over them. §11.1's topic→file migration is a separate change. */}
      <Route path="/app/teams" element={<FoldersPage />} />
      <Route path="/app/teams/:id" element={<FoldersPage />} />
      {/* A team's chat (TEA-5), beside its page. */}
      <Route path="/app/teams/:id/chat" element={<FoldersPage chat />} />
      {/* Where a team's page was until its links said teams. */}
      <Route path="/app/folders" element={<TeamMoved />} />
      <Route path="/app/folders/:id" element={<TeamMoved />} />
      <Route path="/app/folders/:id/chat" element={<TeamMoved />} />
      <Route path="/app/people" element={<PeoplePage />} />
      <Route path="/app/people/:id" element={<PeoplePage />} />
      {/* Where those pages were until FOL-39. */}
      <Route path="/desk" element={<MovedUnderApp />} />
      <Route path="/folders" element={<TeamMoved />} />
      <Route path="/folders/:id" element={<TeamMoved />} />
      <Route path="/folders/:id/chat" element={<TeamMoved />} />
      <Route path="/people" element={<MovedUnderApp />} />
      <Route path="/people/:id" element={<MovedUnderApp />} />
      {/* The retired Topics view (FOL-26). Its list is the Folder tree now, and
          one topic is the file its conversation moved to — `/topic-old/<slug>-
          <channel-uuid>` since FOL-37, and the Peek-private `/topics/<id>`
          before it. These links are in the wild and in every browser history
          that ever opened a topic, so they redirect rather than 404. The list
          is Topics again since TOP-4. */}
      <Route path="/topics" element={<Navigate to="/app/topics" replace />} />
      <Route path="/topic-old/:ref" element={<LegacyTopicRedirect />} />
      <Route path="/topics/:id" element={<LegacyTopicRedirect />} />
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
          names a Convex topic's channel uuid here is sent on to that topic's
          file by `FilePage` (FOL-26). */}
      <Route path="/:word/:ref" element={<FilePage />} />
    </Routes>
  )
}

export default App
