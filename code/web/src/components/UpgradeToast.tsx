// 有新版本：右下角（手机在底部、页签上面）滑出一张卡片——版本从哪到哪、更新了什么（变更记录最上面那节的前几条）、
// 「立即刷新」/「稍后」（半小时后再提醒）。没发出去的话存在本机，刷新也在，卡片上直接告诉你。
import { RefreshCw, Sparkles, X } from 'lucide-react'
import { useStore } from '../store'
import { snoozeUpgrade } from '../live'

export function UpgradeToast() {
  const u = useStore((s) => s.upgrade)
  if (!u) return null
  const serverChanged = u.from !== u.to
  return (
    <div className="upg" role="status">
      <span className="upg-glow" aria-hidden />
      <div className="upg-head">
        <span className="upg-ico"><Sparkles size={18} strokeWidth={2.2} /></span>
        <span className="upg-title">
          <b>Opero 有新版本</b>
          <small>{serverChanged ? `${u.from} → ${u.to}` : '网页更新了'}{serverChanged && u.web ? ' · 网页也更新了' : ''}</small>
        </span>
        <button type="button" className="upg-x" aria-label="稍后" title="稍后（半小时后再提醒）" onClick={snoozeUpgrade}><X size={16} /></button>
      </div>
      {u.notes && u.notes.items.length > 0 && (
        <ul className="upg-notes" data-no-i18n="">
          {u.notes.items.map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
      <p className="upg-sub">刷新一下就用上新版；没发出去的话会留着</p>
      <div className="upg-acts">
        <button type="button" className="btn ghost sm" onClick={snoozeUpgrade}>稍后</button>
        <button type="button" className="btn primary sm upg-go" onClick={() => location.reload()}><RefreshCw size={14} /> 立即刷新</button>
      </div>
    </div>
  )
}
