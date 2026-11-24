// 网址 ↔ 界面：刷新、复制网址给别人、自动更新重载后都回到原来那页。
// 用 # 后面那段（#/workspace/workspace;id=w1/release;id=r3/~/profile;id=e1），不用服务器配合：
// 子路径安装、试用版 /demo、桌面端、App 里都一样。只记字符串参数（页面的 params 本来就只有编号这类）。
import type { Route, Tab } from './types'

export interface Loc {
  tab: Tab
  /** 会话页签里开着的会话 */
  session: string | null
  /** 其它页签的那一摞页面 */
  stack: Route[]
  /** 右边 / 弹出来的面板 */
  panel: Route[] | null
}

const TABS: Tab[] = ['chat', 'people', 'workspace', 'apps', 'me']
const enc = encodeURIComponent

function seg(r: Route): string {
  const ps = Object.entries(r.params ?? {})
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    .map(([k, v]) => `;${enc(k)}=${enc(String(v))}`)
  return enc(r.page) + ps.join('')
}

function unseg(s: string): Route | null {
  const [page, ...ps] = s.split(';')
  const name = decodeURIComponent(page)
  if (!/^[A-Za-z]+$/.test(name)) return null
  const params: Record<string, string> = {}
  for (const p of ps) {
    const i = p.indexOf('=')
    if (i > 0) params[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1))
  }
  return { page: name as Route['page'], ...(ps.length ? { params } : {}) }
}

export function toHash(l: Loc): string {
  const main = l.tab === 'chat' ? (l.session ? [enc(l.session)] : []) : l.stack.map(seg)
  const panel = l.panel?.length ? ['~', ...l.panel.map(seg)] : []
  return '#/' + [l.tab, ...main, ...panel].join('/')
}

/** 认不出来就返回 null（停在默认页） */
export function fromHash(hash: string): Loc | null {
  if (!hash.startsWith('#/')) return null
  try {
    const parts = hash.slice(2).split('/').filter(Boolean)
    const tab = parts.shift() as Tab
    if (!TABS.includes(tab)) return null
    const cut = parts.indexOf('~')
    const main = cut >= 0 ? parts.slice(0, cut) : parts
    const panel = cut >= 0 ? parts.slice(cut + 1).map(unseg).filter((r): r is Route => !!r) : []
    return {
      tab,
      session: tab === 'chat' && main[0] ? decodeURIComponent(main[0]) : null,
      stack: tab === 'chat' ? [] : main.map(unseg).filter((r): r is Route => !!r),
      panel: panel.length ? panel : null,
    }
  } catch {
    return null
  }
}
