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
import { applyLang, initI18n, LANGS, type LangCode } from './i18n'
import './styles.css'

// 语言先定好再画（不然先闪一下中文）：地址带 ?lang=en 就用它（只这一次，不记住），否则用记住的 / 系统的
const q = new URLSearchParams(location.search).get('lang')
const ready = q && LANGS.some((l) => l.code === q) ? applyLang(q as LangCode) : initI18n()

ready.finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        {LIVE || isDemoPath() ? <App /> : <Landing />}
      </ErrorBoundary>
    </StrictMode>,
  )
  if (LIVE) boot()
  startUpdateCheck()
})
