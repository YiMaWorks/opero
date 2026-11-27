// 通用小组件：所有页面都用这一套，保证样式统一。
import { useEffect, useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { IconBack, IconChevron, IconClose } from './icons'

export function PageHeader({ title, sub, onBack, onClose, right }: {
  title: ReactNode; sub?: string; onBack?: () => void; onClose?: () => void; right?: ReactNode
}) {
  return (
    <header className="page-head">
      {onBack && <button className="icon-btn" onClick={onBack} aria-label="返回"><IconBack /></button>}
      <div className="page-head-title">
        <b>{title}</b>
        {sub && <span>{sub}</span>}
      </div>
      {right}
      {onClose && <button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose /></button>}
    </header>
  )
}

export function Section({ title, right, children, flush }: { title?: string; right?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className={'section' + (flush ? ' flush' : '')}>
      {(title || right) && <div className="section-title"><span>{title}</span>{right}</div>}
      <div className="section-body">{children}</div>
    </section>
  )
}

export function Row({ icon, title, sub, right, onClick, chevron, danger }: {
  icon?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void; chevron?: boolean; danger?: boolean
}) {
  const body = (
    <>
      {icon && <span className="row-icon">{icon}</span>}
      <span className="row-main">
        <span className={'row-title' + (danger ? ' danger' : '')}>{title}</span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
      {right !== undefined && <span className="row-right">{right}</span>}
      {chevron && <span className="row-chev"><IconChevron /></span>}
    </>
  )
  // 可点的行用 div + role=button（行里还可能放开关 / 按钮，按钮里不能再套按钮）
  return onClick
    ? <div className="lrow clickable" role="button" tabIndex={0} onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}>{body}</div>
    : <div className="lrow">{body}</div>
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button className={'toggle' + (on ? ' on' : '')} role="switch" aria-checked={on} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onChange(!on) }}>
      <i />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function Tag({ children, tone = 'mute' }: { children: ReactNode; tone?: 'mute' | 'ok' | 'warn' | 'danger' | 'primary' | 'info' }) {
  return <span className={'tag t-' + tone}>{children}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

export function Meter({ value, label }: { value: number; label: string }) {
  const tone = value >= 85 ? 'danger' : value >= 70 ? 'warn' : 'ok'
  return (
    <div className="meter">
      <div className="meter-top"><span>{label}</span><b>{value}%</b></div>
      <div className="meter-bar"><i className={'m-' + tone} style={{ width: `${value}%` }} /></div>
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

export function Table({ cols, rows, bad }: { cols: string[]; rows: ReactNode[][]; bad?: (v: ReactNode) => boolean }) {
  return (
    <div className="table-wrap">
      <table className="tbl big">
        <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((v, j) => <td key={j} className={bad?.(v) ? 'bad' : ''}>{v}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 底部弹层（手机）/ 居中弹框（电脑） */
export function Sheet({ title, onClose, children, size }: { title?: string; onClose: () => void; children: ReactNode; size?: 'lg' }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className={'sheet wide' + (size === 'lg' ? ' lg' : '')} onClick={(e) => e.stopPropagation()}>
        {title && <div className="sheet-title"><b>{title}</b><button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose /></button></div>}
        {children}
      </div>
    </div>
  )
}

/** 右边侧滑出来的面板（电脑）/ 底部弹层（手机）：选东西、看详情用，列表再长也放得下 */
export function Drawer({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="modal-mask drawer-mask" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head"><b>{title}</b><button className="icon-btn" onClick={onClose} aria-label="关闭"><IconClose /></button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </div>
  )
}

export function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'danger' | 'mute' }) {
  return <i className={'sdot s-' + tone} />
}

/** 点一下就地改的文字（名字、标题这类）：显示时后面一支淡淡的笔；点了变输入框，回车 / 点别处保存，Esc 不改。
 *  onSave 返回 false（比如后台说重名）就退回原来的。在可点的行里用也不会触发整行的点击 */
export function InlineText({ value, onSave, placeholder, max = 40, className }: { value: string; onSave: (v: string) => Promise<unknown> | unknown; placeholder?: string; max?: number; className?: string }) {
  const [edit, setEdit] = useState(false)
  const [v, setV] = useState(value)
  useEffect(() => { if (!edit) setV(value) }, [value, edit])
  const done = async (save: boolean) => {
    setEdit(false)
    const t = v.trim()
    if (!save || !t || t === value) { setV(value); return }
    const r = await onSave(t)
    if (r === false || r === null) setV(value)
  }
  if (edit) {
    return (
      <input className={'inline-edit ' + (className ?? '')} autoFocus value={v} maxLength={max} placeholder={placeholder} onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.stopPropagation()} onChange={(e) => setV(e.target.value)} onBlur={() => done(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void done(true) } else if (e.key === 'Escape') { e.preventDefault(); void done(false) } }} />
    )
  }
  return (
    <span className={'inline-text ' + (className ?? '')} role="button" tabIndex={0} title="点一下改"
      onClick={(e) => { e.stopPropagation(); setEdit(true) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setEdit(true) } }}>
      <span className="inline-text-v">{value || placeholder}</span><Pencil className="inline-pen" size={13} strokeWidth={2} />
    </span>
  )
}
