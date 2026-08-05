import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GamePortal } from './games/GamePortal'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GamePortal />
  </StrictMode>,
)
