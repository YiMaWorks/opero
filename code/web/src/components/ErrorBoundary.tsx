// 页面出错兜底：渲染报错显示「这个页面出错了」+ 错误信息 + 刷新 / 返回，不整页白屏。
// 发版后旧页面加载不到已换掉的文件（vite:preloadError）→ 自动刷新一次（30 秒内不重复）。
import { Component, type ReactNode } from 'react'

const RELOAD_KEY = 'opero.preloadReload'
window.addEventListener('vite:preloadError', (e) => {
  const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
  if (Date.now() - last < 30_000) return
  e.preventDefault()
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  location.reload()
})

export class ErrorBoundary extends Component<{ children: ReactNode; inner?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error('[opero] 页面出错', error) }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash">
        <b>这个页面出错了</b>
        <p className="sub">把下面这行发给后台开发员工，它会去修。</p>
        <pre className="crash-msg">{String(error.message || error)}</pre>
        <div className="row-actions center">
          <button className="btn default" onClick={() => this.setState({ error: null })}>再试一次</button>
          <button className="btn primary" onClick={() => location.reload()}>刷新</button>
        </div>
      </div>
    )
  }
}
