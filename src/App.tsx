import { Routes, Route, Navigate } from 'react-router-dom'
import { DeskPage } from './pages/DeskPage'
import { TopicsPage } from './pages/TopicsPage'
import { PeoplePage } from './pages/PeoplePage'

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
      <Route path="/people" element={<PeoplePage />} />
      <Route path="/people/:id" element={<PeoplePage />} />
    </Routes>
  )
}

export default App
