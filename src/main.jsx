import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import TrackPage from './TrackPage.jsx'
import './style.css'

// ---- Global Ripple Effect: semua button ----
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button')
  if (!btn || btn.disabled) return

  const ripple = document.createElement('span')
  const rect = btn.getBoundingClientRect()
  const size = Math.max(rect.width, rect.height) * 2
  ripple.style.cssText = `
    position:absolute;
    width:${size}px;height:${size}px;
    left:${e.clientX - rect.left - size / 2}px;
    top:${e.clientY - rect.top - size / 2}px;
    background:rgba(255,255,255,0.35);
    border-radius:50%;
    transform:scale(0);
    animation:ripple 0.55s ease-out forwards;
    pointer-events:none;
  `
  btn.style.position = 'relative'
  btn.style.overflow = 'hidden'
  btn.appendChild(ripple)
  setTimeout(() => ripple.remove(), 600)
})

const path = window.location.pathname
const trackMatch = path.match(/^\/track\/(.+)$/)

const RootComponent = trackMatch
  ? <TrackPage requestNo={decodeURIComponent(trackMatch[1])} />
  : <App />

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {RootComponent}
  </React.StrictMode>,
)
