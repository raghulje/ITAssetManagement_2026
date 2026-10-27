import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AOS from 'aos'
import App from './App'
import 'aos/dist/aos.css'
import './styles/refex.css'
import './styles/p2p-fx.css'
import './styles/asset-record-detail.css'

AOS.init({
  duration: 700,
  once: true,
  offset: 24,
  easing: 'ease-out-cubic',
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
