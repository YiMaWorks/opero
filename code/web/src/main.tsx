import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Landing from './site/Landing'
import { isDemoPath } from './site/config'
import { ErrorBoundary } from './components/ErrorBoundary'
import './native'
import { startUpdateCheck } from './update'
import { LIVE } from './mode'
import { boot } from './live'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {LIVE || isDemoPath() ? <App /> : <Landing />}
    </ErrorBoundary>
  </StrictMode>,
)

if (LIVE) boot()
startUpdateCheck()
