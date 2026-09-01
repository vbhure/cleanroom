import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { installWebMcpFallback } from './webmcp/fallback'

// Must run before anything reads document.modelContext, so the app takes a
// single code path whether or not the browser implements WebMCP natively.
installWebMcpFallback()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
