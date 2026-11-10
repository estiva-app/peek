import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Player } from './player'
import { SCENARIOS } from './scenarios'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Player scenarios={SCENARIOS} />
  </StrictMode>
)
