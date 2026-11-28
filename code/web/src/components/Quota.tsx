// 订阅账号还剩多少用量：Claude Code、Codex 的 5 小时窗口和本周（后台 quota.ts）。
// 电脑左边栏最下面一小块（compact）、手机「我」页面最上面、「用量和成本」页最上面都用它，数据共用一份，一分钟取一次。
// 两种都主动问官方（不花额度）：打开时、每 10 分钟、点刷新；Claude 员工干活时也会顺带更新。Claude 的官方接口不认某个令牌时，点刷新才退回发一条最小的测试。
import { useEffect, useState } from 'react'
import { Gauge, RefreshCw, X } from 'lucide-react'
import { api } from '../live'

interface Win { used: number; resetsAt?: number }
interface Acc {
  id: string; kind: 'claude' | 'codex'; name: string; user: string; isDefault: boolean; limitedUntil: number; sub: boolean; plan?: string
  quota?: { five?: Win; week?: Win; at: number; err?: string; limited?: boolean; src: 'run' | 'poll' }
}

// 共用一份：第一个用到的组件开始取，之后一分钟一次；打开时让后台问一次 Codex
let cache: Acc[] | null = null
let started = false
const subs = new Set<(a: Acc[]) => void>()
const put = (a?: { accounts: Acc[] }) => { if (!a) return; cache = a.accounts; subs.forEach((f) => f(cache!)) }
const load = () => api<{ accounts: Acc[] }>('GET', '/api/ai/quota').then(put).catch(() => {})
/** 刷新：Codex 订阅账号马上问；claude = true 时 Claude 订阅账号各发一条最小的（用一点点额度）拿用量——只有点按钮才带 */
let busy = false
const busySubs = new Set<(b: boolean) => void>()
export const refreshQuota = (claude = false) => {
  if (claude) { busy = true; busySubs.forEach((f) => f(true)) }
  return api<{ accounts: Acc[] }>('POST', '/api/ai/quota/refresh', { claude }).then(put).catch(() => {}).finally(() => { if (claude) { busy = false; busySubs.forEach((f) => f(false)) } })
}
function useBusy() {
  const [b, setB] = useState(busy)
  useEffect(() => { busySubs.add(setB); return () => { busySubs.delete(setB) } }, [])
  return b
}
function useQuota(): Acc[] | null {
  const [a, setA] = useState(cache)
  useEffect(() => {
    subs.add(setA)
    if (!started) { started = true; void load().then(() => refreshQuota()); setInterval(load, 60_000) }
    return () => { subs.delete(setA) }
  }, [])
  return a
}

const fmtIn = (t?: number) => {
  if (!t) return ''
  const m = Math.round((t - Date.now()) / 60_000)
  if (m <= 0) return '马上重置'
  if (m < 60) return `${m} 分钟后重置`
  if (m < 24 * 60) return `${Math.round(m / 60)} 小时后重置`
  const d = new Date(t)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())} 重置`
}
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60_000); return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 24 * 60 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前` }
const tone = (used: number) => (used >= 95 ? 'bad' : used >= 80 ? 'warn' : 'ok')
const at = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

function Bar({ label, w }: { label: string; w?: Win }) {
  if (!w) return <div className="qt-bar none" title={`${label}这个窗口还没数据：点右上角刷新`}><span className="qt-k">{label}</span><i><b /></i><span className="qt-v">还没数据</span></div>
  const left = Math.max(0, Math.round(100 - w.used))
  return (
    <div className={'qt-bar ' + tone(w.used)} title={`${label}已用 ${Math.round(w.used)}%${w.resetsAt ? ` · ${fmtIn(w.resetsAt)}` : ''}`}>
      <span className="qt-k">{label}</span>
      <i><b style={{ width: `${Math.min(100, w.used)}%` }} /></i>
      <span className="qt-v">{`剩 ${left}%`}</span>
      {w.resetsAt && <small className="qt-reset">{fmtIn(w.resetsAt)}</small>}
    </div>
  )
}

function Row({ a }: { a: Acc }) {
  const q = a.quota
  const limited = a.limitedUntil > Date.now()
  return (
    <div className={'qt-acc' + (limited ? ' limited' : '')}>
      <div className="qt-name">
        <span className={'qt-dot ' + a.kind} />
        <b data-no-i18n="">{a.name}</b>
        {a.isDefault && <small>默认</small>}
      </div>
      {limited ? <div className="qt-limit">{`到上限了 · ${at(a.limitedUntil)} 恢复`}</div>
        : !q || (!q.five && !q.week) ? <div className="qt-api">{q?.err ? `没读到用量：${q.err}` : a.kind === 'claude' ? '还没数据：点右上角刷新查一次' : '还没数据：正在问…'}</div>
        : <><Bar label="5 小时" w={q.five} /><Bar label="本周" w={q.week} /></>}
      {a.sub && q?.at ? <div className="qt-at">{`${ago(q.at)}更新`}{q.err && (q.five || q.week) ? <span className="qt-err">{` · 刷新没成功（显示的是上次的数）：${q.err}`}</span> : null}</div> : null}
    </div>
  )
}

/** 左边图标栏「用量」按钮：剩得最少的那个账号还剩多少（没数据回 undefined）。≤10% 按钮变橙，提醒点开看 */
export function useLowestLeft(): number | undefined {
  const all = useQuota()
  const left = (all ?? []).filter((a) => a.sub).flatMap((a) => (a.limitedUntil > Date.now() ? [0] : [a.quota?.five, a.quota?.week].filter((w): w is Win => !!w).map((w) => 100 - w.used)))
  return left.length ? Math.max(0, Math.round(Math.min(...left))) : undefined
}

/** compact：左边栏最下面那一小块（最多 3 个账号，按剩得少的排前面），点了去「用量和成本」 */
/** 系统支持的订阅（2026-11-28 主人定的：这里只看订阅用量，API Key 不放进来；没接入的照样列一行「未接入」） */
const SUBS: { kind: Acc['kind']; label: string }[] = [
  { kind: 'claude', label: 'Claude Code · Claude 订阅' },
  { kind: 'codex', label: 'Codex · ChatGPT 订阅' },
]
export function QuotaBox({ compact, onOpen, onConnect, onClose }: { compact?: boolean; onOpen?: () => void; onConnect?: () => void; onClose?: () => void }) {
  const all = useQuota()
  const spinning = useBusy()
  if (!all) return null
  const list = all.filter((a) => a.sub)
  const missing = SUBS.filter((x) => !list.some((a) => a.kind === x.kind))
  const leftOf = (a: Acc) => (a.limitedUntil > Date.now() ? -1 : Math.min(...[a.quota?.five, a.quota?.week].map((w) => (w ? 100 - w.used : 100))))
  const shown = compact ? [...list].sort((x, y) => leftOf(x) - leftOf(y)).slice(0, 3) : list
  return (
    <div className={'qt' + (compact ? ' compact' : '')} onClick={compact ? onOpen : undefined} role={compact ? 'button' : undefined}>
      <div className="qt-head">
        <span><Gauge size={14} />订阅用量</span>
        <button type="button" className={'qt-refresh' + (spinning ? ' on' : '')} disabled={spinning} title="刷新：直接问官方还剩多少（不花额度）；Claude 的接口不认某个令牌时，才给它发一条最小的测试（用一点点额度）" onClick={(e) => { e.stopPropagation(); void refreshQuota(true) }}>{spinning ? <><RefreshCw size={13} className="spin" /><small>在查…</small></> : <RefreshCw size={13} />}</button>
        {onClose && <button type="button" className="qt-refresh" aria-label="关闭" title="关闭（Esc）" onClick={(e) => { e.stopPropagation(); onClose() }}><X size={14} /></button>}
      </div>
      {shown.map((a) => <Row key={a.id} a={a} />)}
      {compact && list.length > shown.length && <div className="qt-more">{`还有 ${list.length - shown.length} 个账号 · 点开看全部`}</div>}
      {!compact && onOpen && <button type="button" className="qt-usage-link" onClick={onOpen}>看用量和成本 →</button>}
      {missing.map((x) => (
        <div key={x.kind} className="qt-acc qt-none">
          <div className="qt-name"><span className={'qt-dot off ' + x.kind} /><b>{x.label}</b><small>未接入</small>
            {onConnect && <button type="button" className="qt-connect" onClick={(e) => { e.stopPropagation(); onConnect() }}>去接入</button>}
          </div>
        </div>
      ))}
    </div>
  )
}
