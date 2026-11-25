// 嵌入模式（?embed=1&route=employee;id=e1）：原生 App 里还没做成原生的页面，用 WebView 打开网页的这一页。
// 只显示这一页，没有底部页签、侧栏、会话列表；页面里点到别的页面交给 App（OperoNative.open），App 不支持就在这里一页页往下走；
// App 的返回键先问网页（__operoNative.back）：有弹窗关弹窗、有子页退子页，到顶了 App 自己退。约定见 docs/api/README.md「嵌网页」。
import { useEffect, useRef, useState } from 'react'
import type { Route } from '../types'
import { PageView } from '../pages'
import type { Nav } from '../pages/nav'
import { ErrorBoundary } from './ErrorBoundary'
import { Empty } from './ui'
import { getState, set } from '../store'
import { canNativeClose, nativeClose, nativeOpen, onNativeBack } from '../native'
import { seg, unseg } from '../router'

/** 这次打开是不是嵌入模式：是就返回要显示的那一页（认不出来的也算嵌入，显示「打不开」） */
export const EMBED: { route: Route | null } | null = (() => {
  const q = new URLSearchParams(location.search)
  if (q.get('embed') !== '1') return null
  return { route: unseg(q.get('route') ?? '') }
})()

export function EmbedView({ start }: { start: Route | null }) {
  const [stack, setStack] = useState<Route[]>(start ? [start] : [])
  const depth = useRef(stack.length)
  depth.current = stack.length
  useEffect(() => onNativeBack(() => {
    if (getState().verify) { set({ verify: null }); return true }
    if (depth.current > 1) { setStack((s) => s.slice(0, -1)); return true }
    return false
  }), [])
  if (!stack.length) return <div className="app mobile embed"><Empty>这个页面打不开</Empty></div>
  const top = stack[stack.length - 1]
  const nav: Nav = {
    push: (r) => { if (!nativeOpen(seg(r))) setStack((s) => [...s, r]) },
    back: () => setStack((s) => s.slice(0, -1)),
    canBack: stack.length > 1,
    // 最外层：App 里给一个关闭按钮（回 App 上一层）；浏览器里直接打开的没有
    close: stack.length === 1 && canNativeClose() ? () => { nativeClose() } : undefined,
    openChat: (emp) => { if (!nativeOpen(`chat;emp=${emp}`)) location.href = location.pathname },
    mobile: true,
  }
  return (
    <div className="app mobile embed">
      <div className="m-page full"><ErrorBoundary key={stack.length}><PageView route={top} nav={nav} /></ErrorBoundary></div>
    </div>
  )
}
