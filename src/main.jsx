import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import TrackPage from './TrackPage.jsx'
import './style.css'

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
