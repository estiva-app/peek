import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Nostr-for-Business demo scenario player — run with
//   npx vite demo-scenarios --port 5200
// Standalone: imports nothing from ../src (Peek appears only as an iframe of
// the real app). See STORYBOARD.md for the scene/beat map.
export default defineConfig({
  plugins: [react()],
  server: { port: 5200 },
})
