import { Buffer } from 'buffer'
;(globalThis as Record<string, unknown>).Buffer = Buffer

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/animations.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

createRoot(document.getElementById('root')!, {
  onUncaughtError(error, errorInfo) {
    console.error('[React] Uncaught error:', error, errorInfo);
  },
  onCaughtError(error, errorInfo) {
    console.error('[React] Caught error:', error, errorInfo);
  },
}).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
